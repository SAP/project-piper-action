import { dirname } from 'path'
import { debug, info } from '@actions/core'
import { exec } from '@actions/exec'
import { v4 as uuidv4 } from 'uuid'
import type { ActionConfiguration } from './config'
import { createNetwork, parseDockerEnvVars, removeNetwork, startSidecar } from './sidecar'
import { internalActionVariables } from './piper'

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

  // Since we already changed to the working directory with process.chdir(),
  // process.cwd() now returns the correct directory (e.g., /repo/backend)
  const workingDir = process.cwd()

  // We need the repository root for volume mounting
  const repoRoot = internalActionVariables.originalCwd !== ''
    ? internalActionVariables.originalCwd
    : workingDir

  internalActionVariables.dockerContainerID = containerID
  info(`Starting image ${dockerImage} as container ${containerID}`)
  debug(`Repository root: ${repoRoot}`)
  debug(`Docker working directory: ${workingDir}`)

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
    '--volume', `${repoRoot}:${repoRoot}`,
    '--volume', `${dirname(piperPath)}:/piper`,
    '--workdir', workingDir,
    ...dockerOptionsArray,
    '--name', containerID
  ]

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
    ...parseDockerEnvInherit(actionCfg.dockerEnvInherit !== '' ? actionCfg.dockerEnvInherit : ctxConfig.dockerEnvInherit),
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

  await dockerExecReadOutput(['stop', '--time=1', containerID])
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
    // Workspace (needed for copying artifacts from container builds)
    '--env', 'GITHUB_WORKSPACE',
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
    '--env', 'PIPER_ACTION_VERSION',
    '--env', 'PIPER_PIPELINE_VERSION',
    '--env', 'PIPER_PIPELINE_TEMPLATE_NAME',
    '--env', 'PIPER_PIPELINE_STAGE_TEMPLATE_NAME'
  ]
}

export function getDockerImageFromEnvVar (dockerImage: string): string[] {
  return [
    '--env', `PIPER_dockerImage=${dockerImage}`
  ]
}

/**
 * Parse docker-env-inherit input to inherit environment variables from runner.
 * Accepts comma-separated list of env var names or an array (from config.yml).
 * Example inputs:
 *   - "MY_VAR,ANOTHER_VAR" (comma-separated string)
 *   - ["MY_VAR", "ANOTHER_VAR"] (array from config.yml)
 * @param envInherit - The env-inherit input value (from action input or context config)
 * @returns Array of --env arguments for docker run
 */
export function parseDockerEnvInherit (envInherit: string | string[] | undefined): string[] {
  if (envInherit === undefined || envInherit === '') {
    return []
  }

  const result: string[] = []
  let envVarNames: string[] = []

  if (Array.isArray(envInherit)) {
    // Already an array from context config (config.yml)
    envVarNames = envInherit
  } else if (typeof envInherit === 'string') {
    // Parse as comma-separated list
    envVarNames = envInherit.split(',').map(name => name.trim()).filter(name => name !== '')
  }

  // Generate --env arguments for each variable name (inherits value from host)
  for (const name of envVarNames) {
    if (typeof name === 'string' && name.trim() !== '') {
      result.push('--env', name.trim())
    }
  }

  return result
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
