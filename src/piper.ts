import { debug, setFailed, info, startGroup, endGroup, isDebug } from '@actions/core'
import { exec } from '@actions/exec'
import { chmodSync } from 'fs'
import { basename } from 'path'
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

      if (isDebug()) debugDirectoryStructure('Before step execution')

      // Check if the step exists in SAP Piper by running --help
      if (!isEnterpriseStep(actionCfg.stepName, actionCfg.flags)) {
        // NOTE: When non-zero value is returned error appears in GH logs. That is why we use { silent: true }.
        const helpResult = await executePiper(actionCfg.stepName, ['--help'], false, { silent: true })
        if (helpResult.exitCode !== 0) {
          debug(`Step ${actionCfg.stepName} not found in SAP Piper, switching to OS Piper`)
          await downloadAndSetOSPiper(actionCfg)
        }
      }

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()

      if (isDebug()) debugDirectoryStructure('After step execution')
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

  // Check for pre-built SAP Piper binary from composite action
  const prebuiltSapPiperPath = process.env.SAP_PIPER_BINARY_PATH ?? ''
  if (prebuiltSapPiperPath !== '') {
    info(`Using pre-built SAP Piper binary from: ${prebuiltSapPiperPath}`)
    return prebuiltSapPiperPath
  }

  // Try SAP Piper first when enterprise config is available
  if (actionCfg.sapPiperOwner !== '' && actionCfg.sapPiperRepo !== '' && actionCfg.gitHubEnterpriseToken !== '') {
    info('Downloading SAP Piper binary')
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.flags, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }

  // No enterprise config, download OS Piper directly
  info('Downloading OS Piper binary')
  return await downloadPiperBinary('', '', actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}

async function downloadAndSetOSPiper (actionCfg: ActionConfiguration): Promise<void> {
  info('Step not found in SAP Piper, switching to OS Piper')

  const osPiperPath = await downloadOSPiperBinary(actionCfg)
  chmodSync(osPiperPath, 0o775)
  internalActionVariables.piperBinPath = osPiperPath

  // If running in Docker, copy the OS Piper binary into the container's /piper/ mount
  const containerID = internalActionVariables.dockerContainerID
  if (containerID !== '') {
    info('Copying OS Piper binary into running container')
    await exec('docker', ['cp', osPiperPath, `${containerID}:/piper/${basename(osPiperPath)}`])
  }
}

async function downloadOSPiperBinary (actionCfg: ActionConfiguration): Promise<string> {
  // Try GHE mirror first (SAP/jenkins-library on enterprise instance)
  if (actionCfg.gitHubEnterpriseApi !== '' && actionCfg.gitHubEnterpriseToken !== '') {
    try {
      info('Trying OS Piper download from GHE mirror')
      return await downloadPiperBinary('', '', actionCfg.piperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.piperOwner, actionCfg.piperRepo)
    } catch (err) {
      info(`GHE mirror download failed: ${err instanceof Error ? err.message : String(err)}, falling back to github.com`)
    }
  }

  // Fall back to public github.com
  info('Downloading OS Piper from github.com')
  return await downloadPiperBinary('', '', actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}
