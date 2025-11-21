import { debug, setFailed, info, startGroup, endGroup, isDebug } from '@actions/core'
import { buildPiperFromBranch, buildPiperFromSource } from './github'
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
import {
  changeToWorkingDirectory, cleanupMonorepoSymlinks,
  restoreOriginalDirectory, setupMonorepoSymlinks, tokenize
} from './utils'
import { buildPiperInnerSource } from './build'
import { downloadPiperBinary } from './download'
import { debugDirectoryStructure } from './debug'

// Global runtime variables that is accessible within a single action execution
export const internalActionVariables = {
  piperBinPath: '',
  dockerContainerID: '',
  sidecarNetworkID: '',
  sidecarContainerID: '',
  workingDir: '.',
  gitSymlinkCreated: false,
  pipelineSymlinkCreated: false,
  originalCwd: ''
}

export async function run (): Promise<void> {
  try {
    startGroup('Setup')
    info('Getting action configuration')
    const actionCfg: ActionConfiguration = await getActionConfig({ required: false })
    debug(`Action configuration: ${JSON.stringify(actionCfg)}`)

    // Set up symlinks BEFORE changing directory
    info('Setting working directory')
    internalActionVariables.workingDir = actionCfg.workingDir

    info('Setting up symlinks for subdirectory (git and pipeline)')
    setupMonorepoSymlinks(actionCfg.workingDir)

    // Change to working directory after symlinks are created
    changeToWorkingDirectory(actionCfg.workingDir)

    info('Preparing Piper binary')
    await preparePiperBinary(actionCfg)

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
      endGroup()
    }
    if (actionCfg.stepName !== '') {
      startGroup('Step Configuration')
      const flags = tokenize(actionCfg.flags)
      const contextConfig = await readContextConfig(actionCfg.stepName, flags)
      endGroup()

      await runContainers(actionCfg, contextConfig)

      if (isDebug()) debugDirectoryStructure()

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()

      if (isDebug()) debugDirectoryStructure()
    }

    await exportPipelineEnv(actionCfg.exportPipelineEnvironment)
  } catch (error: unknown) {
    setFailed(error instanceof Error ? error.message : String(error))
  } finally {
    await cleanupContainers()
    restoreOriginalDirectory()
    cleanupMonorepoSymlinks()
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
    // Check unsafe variant first (new way)
    if (actionCfg.unsafeSapPiperVersion !== '' && actionCfg.unsafeSapPiperVersion.startsWith('devel:') && !actionCfg.exportPipelineEnvironment) {
      info('Building Piper from inner source (unsafe-sap-piper-version)')
      return await buildPiperInnerSource(actionCfg.unsafeSapPiperVersion, actionCfg.wdfGithubEnterpriseToken)
    }
    // Fall back to deprecated variant
    if (actionCfg.sapPiperVersion.startsWith('devel:') && !actionCfg.exportPipelineEnvironment) {
      info('Building Piper from inner source (deprecated sap-piper-version)')
      return await buildPiperInnerSource(actionCfg.sapPiperVersion, actionCfg.wdfGithubEnterpriseToken)
    }
    info('Downloading Piper Inner source binary')
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.flags, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }
  // Check unsafe variant first (new way - uses branch names)
  if (actionCfg.unsafePiperVersion !== '' && actionCfg.unsafePiperVersion.startsWith('devel:')) {
    info('Building OS Piper from branch (unsafe-piper-version)')
    return await buildPiperFromBranch(actionCfg.unsafePiperVersion, actionCfg.gitHubToken)
  }
  // Fall back to deprecated variant (uses commit SHAs)
  if (actionCfg.piperVersion.startsWith('devel:')) {
    info('Building OS Piper from source (deprecated piper-version)')
    return await buildPiperFromSource(actionCfg.piperVersion)
  }
  info('Downloading Piper OS binary')
  return await downloadPiperBinary(actionCfg.stepName, actionCfg.flags, actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}
