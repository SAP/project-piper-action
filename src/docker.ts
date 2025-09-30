import { dirname } from 'path'
import { debug, info } from '@actions/core'
import { exec } from '@actions/exec'
import { v4 as uuidv4 } from 'uuid'
import type { ActionConfiguration } from './config'
import { createNetwork, parseDockerEnvVars, removeNetwork, startSidecar } from './sidecar'
import { internalActionVariables } from './piper'
import { BuildToolManager } from './buildTools'

export async function runContainers (actionCfg: ActionConfiguration, ctxConfig: any): Promise<void> {
  const sidecarImage = actionCfg.sidecarImage !== '' ? actionCfg.sidecarImage : ctxConfig.sidecarImage as string
  if (sidecarImage !== undefined && sidecarImage !== '') {
    await createNetwork()
    await startSidecar(actionCfg, ctxConfig, sidecarImage)
  }

  await startContainer(actionCfg, ctxConfig)
}

export async function startContainer (actionCfg: ActionConfiguration, ctxConfig: any): Promise<void> {
  const dockerImage = actionCfg.dockerImage !== '' ? actionCfg.dockerImage : ctxConfig.dockerImage
  if (dockerImage === undefined || dockerImage === '') return

  const piperPath = internalActionVariables.piperBinPath
  const containerID = uuidv4()
  const cwd = process.cwd()
  internalActionVariables.dockerContainerID = containerID
  info(`Starting image ${dockerImage} as container ${containerID}`)

  let dockerOptionsArray: string[] = []
  const dockerOptions = actionCfg.dockerOptions !== '' ? actionCfg.dockerOptions : ctxConfig.dockerOptions
  if (dockerOptions !== undefined) {
    dockerOptionsArray = Array.isArray(dockerOptions)
      ? dockerOptions.map(option => option.split(' ')).flat()
      : dockerOptionsArray = dockerOptions.split(' ')
  }

  const dockerRunArgs: string[] = [
    'run',
    '--tty',
    '--detach',
    '--rm',
    '--user', '1000:1000',
    '--volume', `${cwd}:${cwd}`,
    '--volume', `${dirname(piperPath)}:/piper`,
    '--workdir', cwd,
    // Docker performance optimizations
    '--memory', '4g',
    '--cpus', '2.0',
    '--shm-size', '1g', // Increase shared memory for parallel compilation
    '--tmpfs', '/tmp:rw,nosuid,size=1g', // Fast temporary filesystem
    ...dockerOptionsArray,
    '--name', containerID
  ]

  // Check cache state from environment variables
  const cacheRestored = process.env.PIPER_CACHE_RESTORED === 'true'
  const dependenciesChanged = process.env.PIPER_DEPENDENCIES_CHANGED === 'true'

  // Add cache directory volumes if specified
  const cacheDir = process.env.PIPER_CACHE_DIR ?? ''
  const buildToolName = process.env.PIPER_BUILD_TOOL ?? ''

  if (cacheDir !== '' && buildToolName !== '') {
    const manager = new BuildToolManager()
    const buildTool = manager.getBuildToolByName(buildToolName)

    if (buildTool !== null) {
      // Mount cache directory based on build tool
      dockerRunArgs.push(
        '--volume', `${cacheDir}:${buildTool.dockerMountPath}`
      )

      // Get build tool specific environment variables
      const envVars = buildTool.getDockerEnvironmentVariables(cacheRestored, dependenciesChanged)
      for (const envVar of envVars) {
        if (envVar.includes('=')) {
          const [key, value] = envVar.split('=', 2)
          dockerRunArgs.push('--env', `${key}=${value}`)
        } else {
          dockerRunArgs.push('--env', envVar)
        }
      }

      debug(`Mounted ${buildTool.name} cache: ${cacheDir} to ${buildTool.dockerMountPath}`)
      debug(`Cache restored: ${cacheRestored}, Dependencies changed: ${dependenciesChanged}`)
      debug(`${buildTool.name} optimized for cached dependencies`)
    } else {
      debug(`Build tool ${buildToolName} not found in manager`)
    }
  } else if (cacheDir !== '') {
    // Fallback: mount as generic cache if no specific build tool detected
    dockerRunArgs.push(
      '--volume', `${cacheDir}:/home/ubuntu/.cache`
    )
    debug(`Mounted generic cache: ${cacheDir} to /home/ubuntu/.cache`)
  }

  // Always pass cache state environment variables to container for Piper to read
  dockerRunArgs.push(
    '--env', `PIPER_CACHE_RESTORED=${cacheRestored ? 'true' : 'false'}`,
    '--env', `PIPER_DEPENDENCIES_CHANGED=${dependenciesChanged ? 'true' : 'false'}`
  )

  // Pass build tool name to container if available
  if (buildToolName !== '') {
    dockerRunArgs.push('--env', `PIPER_BUILD_TOOL=${buildToolName}`)
  }

  const networkID = internalActionVariables.sidecarNetworkID
  if (networkID !== '') {
    dockerRunArgs.push('--network', networkID)

    const networkAlias = ctxConfig.dockerName ?? ''
    if (networkAlias !== '') {
      dockerRunArgs.push('--network-alias', networkAlias)
    }
  }

  dockerRunArgs.push(
    ...parseDockerEnvVars(actionCfg.dockerEnvVars, ctxConfig.dockerEnvVars),
    ...getProxyEnvVars(),
    ...getOrchestratorEnvVars(),
    ...getVaultEnvVars(),
    ...getSystemTrustEnvVars(),
    ...getTelemetryEnvVars(),
    ...getDockerImageFromEnvVar(dockerImage),
    dockerImage,
    'cat'
  )

  await dockerExecReadOutput(dockerRunArgs)
}

export async function cleanupContainers (): Promise<void> {
  await stopContainer(internalActionVariables.dockerContainerID)
  await stopContainer(internalActionVariables.sidecarContainerID)
  await removeNetwork(internalActionVariables.sidecarNetworkID)
}

export async function stopContainer (containerID: string): Promise<void> {
  if (containerID === '') {
    debug('no container to stop')
    return
  }

  await dockerExecReadOutput(['stop', '--timeout=1', containerID])
}

/** expose env vars needed for Piper orchestrator package (https://github.com/SAP/jenkins-library/blob/master/pkg/orchestrator/gitHubActions.go) */
export function getOrchestratorEnvVars (): string[] {
  return [
    // needed for Piper orchestrator detection
    '--env', 'GITHUB_ACTION',
    '--env', 'GITHUB_ACTIONS',
    // Build Info
    '--env', 'GITHUB_JOB',
    '--env', 'GITHUB_RUN_ID',
    '--env', 'GITHUB_REF',
    '--env', 'GITHUB_REF_NAME',
    '--env', 'GITHUB_SERVER_URL',
    '--env', 'GITHUB_API_URL',
    '--env', 'GITHUB_REPOSITORY',
    '--env', 'GITHUB_SHA',
    '--env', 'GITHUB_WORKFLOW_REF',
    // Pull Request Info (needed for sonarExecuteScan)
    '--env', 'GITHUB_HEAD_REF',
    '--env', 'GITHUB_BASE_REF',
    '--env', 'GITHUB_EVENT_PULL_REQUEST_NUMBER'
  ]
}

export function getVaultEnvVars (): string[] {
  return [
    '--env', 'PIPER_vaultAppRoleID',
    '--env', 'PIPER_vaultAppRoleSecretID'
  ]
}

export function getProxyEnvVars (): string[] {
  return [
    '--env', 'http_proxy',
    '--env', 'https_proxy',
    '--env', 'no_proxy',
    '--env', 'HTTP_PROXY',
    '--env', 'HTTPS_PROXY',
    '--env', 'NO_PROXY'
  ]
}

export function getSystemTrustEnvVars (): string[] {
  return [
    '--env', 'PIPER_systemTrustToken',
    // PIPER_trustEngineToken is still created for compatibility with jenkins-library version from v1.383.0 to 1.414.0. Remove it in ~June 2025
    '--env', 'PIPER_trustEngineToken',
    '--env', 'PIPER_ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    '--env', 'PIPER_ACTIONS_ID_TOKEN_REQUEST_URL'
  ]
}

export function getTelemetryEnvVars (): string[] {
  return [
    '--env', 'PIPER_PIPELINE_TEMPLATE_NAME'
  ]
}

export function getDockerImageFromEnvVar (dockerImage: string): string[] {
  return [
    '--env', `PIPER_dockerImage=${dockerImage}`
  ]
}

export async function dockerExecReadOutput (dockerRunArgs: string[]): Promise<string> {
  let dockerOutput = ''
  let dockerError = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        dockerOutput += data.toString()
      },
      stderr: (data: Buffer) => {
        dockerError += data.toString()
      }
    },
    ignoreReturnCode: true
  }

  const exitCode = await exec('docker', dockerRunArgs, options)
  dockerOutput = dockerOutput.trim()
  dockerError = dockerError.trim()

  if (exitCode !== 0) {
    const errorMessage = dockerError.length > 0
      ? dockerError
      : dockerOutput.length > 0
        ? dockerOutput
        : 'Unknown error'
    throw new Error(`docker execute failed with exit code ${exitCode}: ${errorMessage}`)
  }

  return dockerOutput
}
