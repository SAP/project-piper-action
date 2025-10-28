import { debug, setFailed, info, startGroup, endGroup } from '@actions/core'
import { buildPiperFromSource } from './github'
import { chmodSync, existsSync, cpSync, mkdirSync } from 'fs'
import * as path from 'path'
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
  sidecarContainerID: '',
  workingDir: '.'
}

export async function run (): Promise<void> {
  try {
    startGroup('Setup')
    info('Getting action configuration')
    const actionCfg: ActionConfiguration = await getActionConfig({ required: false })
    debug(`Action configuration: ${JSON.stringify(actionCfg)}`)

    info('Preparing Piper binary')
    await preparePiperBinary(actionCfg)

    info('Setting working directory')
    internalActionVariables.workingDir = actionCfg.workingDir
    debug(`Working directory: ${internalActionVariables.workingDir}`)

    info('Loading pipeline environment')
    await loadPipelineEnv()
    endGroup()

    startGroup('version')
    info('Getting version')
    await executePiper('version')
    endGroup()

    if (onGitHubEnterprise() && actionCfg.stepName !== 'getDefaults') {
      startGroup('Enterprise Configuration')
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

      info('Copying .pipeline folder to working directory')
      copyPipelineFolder(actionCfg.workingDir)

      endGroup()
    }
    if (actionCfg.stepName !== '') {
      startGroup('Step Configuration')
      const flags = tokenize(actionCfg.flags)
      const contextConfig = await readContextConfig(actionCfg.stepName, flags)
      endGroup()

      await runContainers(actionCfg, contextConfig)

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()
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

  if (isEnterpriseStep(actionCfg.stepName, actionCfg.flags)) {
    info('Preparing Piper binary for enterprise step')
    // devel:ORG_NAME:REPO_NAME:ff8df33b8ab17c19e9f4c48472828ed809d4496a
    if (actionCfg.sapPiperVersion.startsWith('devel:') && !actionCfg.exportPipelineEnvironment) {
      info('Building Piper from inner source')
      return await buildPiperInnerSource(actionCfg.sapPiperVersion, actionCfg.wdfGithubEnterpriseToken)
    }
    info('Downloading Piper Inner source binary')
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.flags, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }
  // devel:SAP:jenkins-library:ff8df33b8ab17c19e9f4c48472828ed809d4496a
  if (actionCfg.piperVersion.startsWith('devel:')) {
    info('Building OS Piper from source')
    return await buildPiperFromSource(actionCfg.piperVersion)
  }
  info('Downloading Piper OS binary')
  return await downloadPiperBinary(actionCfg.stepName, actionCfg.flags, actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}

function copyPipelineFolder (workingDir: string): void {
  // Only copy if working directory is different from current directory
  if (workingDir === '.' || workingDir === '') {
    debug('Working directory is root, skipping .pipeline folder copy')
    return
  }

  const sourcePipelineDir = path.join(process.cwd(), '.pipeline')
  const targetPipelineDir = path.join(process.cwd(), workingDir, '.pipeline')

  // Check if source .pipeline folder exists
  if (!existsSync(sourcePipelineDir)) {
    debug('Source .pipeline folder does not exist, skipping copy')
    return
  }

  info(`Copying .pipeline folder from root to ${workingDir}`)
  debug(`Source: ${sourcePipelineDir}`)
  debug(`Target: ${targetPipelineDir}`)

  try {
    // Ensure target parent directory exists
    const targetParent = path.join(process.cwd(), workingDir)
    if (!existsSync(targetParent)) {
      mkdirSync(targetParent, { recursive: true })
    }

    // Ensure target .pipeline directory exists
    if (!existsSync(targetPipelineDir)) {
      mkdirSync(targetPipelineDir, { recursive: true })
    }

    // Copy/merge the .pipeline folder contents
    // The 'force' option will overwrite existing files, and 'recursive' will copy subdirectories
    cpSync(sourcePipelineDir, targetPipelineDir, { recursive: true, force: true })
    info('.pipeline folder copied/merged successfully')
  } catch (error) {
    throw new Error(`Failed to copy .pipeline folder: ${error instanceof Error ? error.message : String(error)}`)
  }
}
