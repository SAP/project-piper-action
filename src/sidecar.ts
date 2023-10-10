import { exec } from '@actions/exec'
import { dockerExecReadOutput, getOrchestratorEnvVars, getProxyEnvVars, getVaultEnvVars } from './docker'
import { v4 as uuidv4 } from 'uuid'
import { debug, exportVariable, info, warning } from '@actions/core'
import type { ActionConfiguration } from './piper'

const NETWORK_PREFIX = 'sidecar-'

export async function startSidecar (actionCfg: ActionConfiguration, ctxConfig: any, sidecarImage: string): Promise<void> {
  const piperPath = process.env.piperPath
  if (piperPath === undefined) {
    await Promise.reject(new Error('piperPath environmental variable is undefined!')); return
  }

  const containerID = uuidv4()
  exportVariable('PIPER_ACTION_sidecarContainerID', containerID)
  info(`Starting image ${sidecarImage} as sidecar ${containerID}`)

  const sidecarOptions = actionCfg.sidecarOptions !== '' ? actionCfg.sidecarOptions : ctxConfig.sidecarOptions
  let sidecarOptionsArray: string[] = []
  if (sidecarOptions !== undefined && Array.isArray(sidecarOptions)) {
    sidecarOptionsArray = sidecarOptions.map(option => option.split(' ')).flat()
  } else if (sidecarOptions !== undefined) {
    sidecarOptionsArray = sidecarOptions.split(' ')
  }

  const dockerRunArgs: string[] = [
    'run',
    '--detach',
    '--rm',
    ...sidecarOptionsArray,
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
    ...parseDockerEnvVars(actionCfg.sidecarEnvVars, ctxConfig.sidecarEnvVars),
    ...getProxyEnvVars(),
    ...getOrchestratorEnvVars(),
    ...getVaultEnvVars(),
    sidecarImage
  )

  await exec('docker', dockerRunArgs)
}

export async function createNetwork (): Promise<void> {
  const networkName = NETWORK_PREFIX + uuidv4()

  info(`Creating network ${networkName}`)
  const result = await dockerExecReadOutput(['network', 'create', networkName])
  if (result === '') {
    return
  }

  exportVariable('PIPER_ACTION_dockerNetworkID', networkName)
  info('Network created')
}

export async function removeNetwork (): Promise<void> {
  const networkID = process.env.PIPER_ACTION_dockerNetworkID ?? ''
  if (networkID === '') {
    debug('no network to remove')
    return
  }

  await dockerExecReadOutput(['network', 'remove', networkID])
}

export function parseDockerEnvVars (actionCfgEnvVars: string, ctxConfigEnvVars: any): string[] {
  let jsonStringEnvVars = actionCfgEnvVars !== '' ? actionCfgEnvVars : ctxConfigEnvVars
  if (jsonStringEnvVars === undefined) {
    return []
  }

  const result: string[] = []
  if (typeof jsonStringEnvVars === 'string') {
    try {
      jsonStringEnvVars = JSON.parse(jsonStringEnvVars)
    } catch (err) {
      warning(`sidecarEnvVars value ${jsonStringEnvVars as string} is not a JSON-formatted string, therefore ignore it`)
      jsonStringEnvVars = {}
    }
  }

  Object.entries(jsonStringEnvVars)
    .forEach(([key, value]) => {
      result.push('--env')
      result.push(`${key}=${value as string}`)
    })

  return result
}
