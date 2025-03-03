import { debug, setFailed, info } from '@actions/core'
import { buildPiperFromSource } from './github'
import { chmodSync } from 'fs'
import { executePiper } from './execute'
import {
  type ActionConfiguration,
  getDefaultConfig,
  readContextConfig,
  createCheckIfStepActiveMaps,
  getActionConfig
} from './config'
import { loadPipelineEnv, exportPipelineEnv } from './pipelineEnv'
import { cleanupContainers, runContainers } from './docker'
import { isEnterpriseStep, onGitHubEnterprise } from './enterprise'
import { tokenize } from './utils'
import { buildPiperInnerSource } from './build'
import { downloadPiperBinary } from './download'

// Global runtime variables that is accessible within a single action execution
export const internalActionVariables = {
  piperBinPath: '',
  dockerContainerID: '',
  sidecarNetworkID: '',
  sidecarContainerID: ''
}

export async function run (): Promise<void> {
  try {
    info('Getting action configuration')
    const actionCfg: ActionConfiguration = await getActionConfig({ required: false })
    debug(`Action configuration: ${JSON.stringify(actionCfg)}`)

    info('Preparing Piper binary')
    await preparePiperBinary(actionCfg)

    info('Loading pipeline environment')
    await loadPipelineEnv()

    info('Executing action - version')
    await executePiper('version')
    if (onGitHubEnterprise() && actionCfg.stepName !== 'getDefaults') {
      debug('Enterprise step detected')
      await getDefaultConfig(
        actionCfg.gitHubEnterpriseServer,
        actionCfg.gitHubEnterpriseApi,
        actionCfg.sapPiperVersion,
        actionCfg.gitHubEnterpriseToken,
        actionCfg.sapPiperOwner,
        actionCfg.sapPiperRepo,
        actionCfg.customDefaultsPaths
      )
      if (actionCfg.createCheckIfStepActiveMaps) {
        await createCheckIfStepActiveMaps(actionCfg)
      }
    }
    if (actionCfg.stepName !== '') {
      const flags = tokenize(actionCfg.flags)
      const contextConfig = await readContextConfig(actionCfg.stepName, flags)
      await runContainers(actionCfg, contextConfig)
      await executePiper(actionCfg.stepName, flags)
    }
    await exportPipelineEnv(actionCfg.exportPipelineEnvironment)
  } catch (error: unknown) {
    setFailed(error instanceof Error ? error.message : String(error))
  } finally {
    await cleanupContainers()
  }
}

async function preparePiperBinary (actionCfg: ActionConfiguration): Promise<void> {
  const piperPath: string = await preparePiperPath(actionCfg)

  if (piperPath === undefined || piperPath === '') {
    throw new Error('Piper binary path is empty. Please check your action inputs.')
  }

  internalActionVariables.piperBinPath = piperPath
  debug('obtained piper binary at '.concat(piperPath))
  chmodSync(piperPath, 0o775)
}

async function preparePiperPath (actionCfg: ActionConfiguration): Promise<string> {
  debug('Preparing Piper binary path with configuration '.concat(JSON.stringify(actionCfg)))

  if (isEnterpriseStep(actionCfg.stepName)) {
    info('Preparing Piper binary for enterprise step')
    // devel:ORG_NAME:REPO_NAME:ff8df33b8ab17c19e9f4c48472828ed809d4496a
    if (actionCfg.sapPiperVersion.startsWith('devel:') && !actionCfg.exportPipelineEnvironment) {
      info('Building Piper from inner source')
      return await buildPiperInnerSource(actionCfg.sapPiperVersion, actionCfg.wdfGithubEnterpriseToken)
    }
    info('Downloading Piper Inner source binary')
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }
  // devel:SAP:jenkins-library:ff8df33b8ab17c19e9f4c48472828ed809d4496a
  if (actionCfg.piperVersion.startsWith('devel:')) {
    info('Building OS Piper from source')
    return await buildPiperFromSource(actionCfg.piperVersion)
  }
  info('Downloading Piper OS binary')
  return await downloadPiperBinary(actionCfg.stepName, actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}
