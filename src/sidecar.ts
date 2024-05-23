import { exec } from '@actions/exec'
import {
  dockerExecReadOutput,
  getOrchestratorEnvVars,
  getProxyEnvVars,
  getVaultEnvVars
} from './docker'
import { v4 as uuidv4 } from 'uuid'
import { debug, info, warning } from '@actions/core'
import type { ActionConfiguration } from './piper'
import { internalActionVariables } from './piper'

const NETWORK_PREFIX = 'sidecar-'

export async function startSidecar (actionCfg: ActionConfiguration, ctxConfig: any, sidecarImage: string): Promise<void> {
  const containerID = uuidv4()
  internalActionVariables.sidecarContainerID = containerID
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

  const networkID = internalActionVariables.sidecarNetworkID
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

  internalActionVariables.sidecarNetworkID = networkName
  info('Network created')
}

export async function removeNetwork (networkID: string): Promise<void> {
  if (networkID === '') {
    debug('no network to remove')
    return
  }

  await dockerExecReadOutput(['network', 'remove', networkID])
}

export function parseDockerEnvVars (actionCfgEnvVars: string, ctxConfigEnvVars: any): string[] {
  
  info(`actionCfgEnvVars: ${actionCfgEnvVars}`)
  info(`roleID::: ${process.env.PIPER_vaultAppRoleID}`)
  info(`secretID::: ${process.env.PIPER_vaultAppRoleSecretID}`)
  info(`GITHUB_TOKEN::: ${process.env.GITHUB_TOKEN}`)
  

  let jsonStringEnvVars = actionCfgEnvVars !== '' ? actionCfgEnvVars : ctxConfigEnvVars
  if (jsonStringEnvVars === undefined) {
    return []
  }

  const result: string[] = []
  if (typeof jsonStringEnvVars === 'string') {
    info(`typeof jsonStringEnvVars: ${typeof jsonStringEnvVars}`)
    try {
      jsonStringEnvVars = JSON.parse(jsonStringEnvVars)
      info(`jsonStringEnvVars: ${jsonStringEnvVars}`)
    } catch (err) {
      warning(`sidecarEnvVars value ${jsonStringEnvVars as string} is not a JSON-formatted string, therefore ignore it`)
      jsonStringEnvVars = {}
    }
  }

  Object.entries(jsonStringEnvVars)
    .forEach(([key, value]) => {
      info(`key: ${key}, value: ${value}`)
      result.push('--env')
      // if (value === '') {
        // result.push(key)
      // } else {
        result.push(`${key}=${value}`)
      // }
    })

  return result
}
