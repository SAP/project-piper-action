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
    '--env', 'PIPER_PIPELINE_TEMPLATE_NAME',
    '--env', 'PIPER_PIPELINE_STAGE_TEMPLATE_NAME'
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
