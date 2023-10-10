import { dirname } from 'path'
import { debug, exportVariable, info } from '@actions/core'
import { exec } from '@actions/exec'
import { v4 as uuidv4 } from 'uuid'
import type { ActionConfiguration } from './piper'
import { createNetwork, parseDockerEnvVars, removeNetwork, startSidecar } from './sidecar'

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
  if (dockerImage === undefined || dockerImage === '') {
    return
  }

  const piperPath = process.env.piperPath
  if (piperPath === undefined) {
    await Promise.reject(new Error('piperPath environmental variable is undefined!'))
    return
  }

  const containerID = uuidv4()
  const cwd = process.cwd()
  exportVariable('PIPER_ACTION_dockerContainerID', containerID)
  info(`Starting image ${dockerImage} as container ${containerID}`)

  let dockerOptionsArray: string[] = []
  const dockerOptions = actionCfg.dockerOptions !== '' ? actionCfg.dockerOptions : ctxConfig.dockerOptions
  if (dockerOptions !== undefined && Array.isArray(dockerOptions)) {
    dockerOptionsArray = dockerOptions.map(option => option.split(' ')).flat()
  } else if (dockerOptions !== undefined) {
    dockerOptionsArray = dockerOptions.split(' ')
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

  const networkID = process.env.PIPER_ACTION_dockerNetworkID ?? ''
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
    dockerImage,
    'cat'
  )

  await dockerExecReadOutput(dockerRunArgs)
}

export async function cleanupContainers (): Promise<void> {
  await stopContainer(process.env.PIPER_ACTION_dockerContainerID ?? '')
  await stopContainer(process.env.PIPER_ACTION_sidecarContainerID ?? '')
  await removeNetwork()
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
    '--env',
    'GITHUB_ACTION',
    '--env',
    'GITHUB_ACTIONS',
    // Build Info
    '--env',
    'GITHUB_JOB',
    '--env',
    'GITHUB_RUN_ID',
    '--env',
    'GITHUB_REF',
    '--env',
    'GITHUB_REF_NAME',
    '--env',
    'GITHUB_SERVER_URL',
    '--env',
    'GITHUB_API_URL',
    '--env',
    'GITHUB_REPOSITORY',
    '--env',
    'GITHUB_SHA',
    // Pull Request Info (needed for sonarExecuteScan)
    '--env',
    'GITHUB_HEAD_REF',
    '--env',
    'GITHUB_BASE_REF',
    '--env',
    'GITHUB_EVENT_PULL_REQUEST_NUMBER'
  ]
}

export function getVaultEnvVars (): string[] {
  return [
    '--env',
    'PIPER_vaultAppRoleID',
    '--env',
    'PIPER_vaultAppRoleSecretID'
  ]
}

export function getProxyEnvVars (): string[] {
  return [
    '--env',
    'http_proxy',
    '--env',
    'https_proxy',
    '--env',
    'no_proxy',
    '--env',
    'HTTP_PROXY',
    '--env',
    'HTTPS_PROXY',
    '--env',
    'NO_PROXY'
  ]
}

export async function dockerExecReadOutput (dockerRunArgs: string[]): Promise<string> {
  let dockerOutput = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        dockerOutput += data.toString()
      }
    }
  }
  dockerOutput = dockerOutput.trim()

  const exitCode = await exec('docker', dockerRunArgs, options)
  if (exitCode !== 0) {
    await Promise.reject(new Error('docker execute failed: ' + dockerOutput))
    return ''
  }

  return dockerOutput
}
