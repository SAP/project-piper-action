import { debug, setFailed, info, startGroup, endGroup, warning } from '@actions/core'
import { buildPiperFromSource } from './github'
import { chmodSync, existsSync, readdirSync, statSync, symlinkSync, unlinkSync, lstatSync } from 'fs'
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
  workingDir: '.',
  gitSymlinkCreated: false
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
    debug(`Working directory: ${actionCfg.workingDir}`)

    info('Setting up git repository access for subdirectory')
    setupGitSymlink(actionCfg.workingDir)

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

      debugDirectoryStructure()

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()

      debugDirectoryStructure()
    }

    await exportPipelineEnv(actionCfg.exportPipelineEnvironment)
  } catch (error: unknown) {
    setFailed(error instanceof Error ? error.message : String(error))
  } finally {
    cleanupGitSymlink()
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

// Debug logging functions
function printDirectoryTree (dirPath: string, prefix: string = '', maxDepth: number = 2, currentDepth: number = 0): void {
  if (currentDepth >= maxDepth) return

  try {
    const items = readdirSync(dirPath)
    items.forEach((item, index) => {
      const itemPath = path.join(dirPath, item)
      const isLast = index === items.length - 1
      const connector = isLast ? '└── ' : '├── '

      try {
        const stats = statSync(itemPath)
        const itemType = stats.isDirectory() ? '📁' : '📄'
        info(`${prefix}${connector}${itemType} ${item}`)

        if (stats.isDirectory() && !item.startsWith('.git') && item !== 'node_modules') {
          const newPrefix = prefix + (isLast ? '    ' : '│   ')
          printDirectoryTree(itemPath, newPrefix, maxDepth, currentDepth + 1)
        }
      } catch (err) {
        debug(`Cannot access ${itemPath}`)
      }
    })
  } catch (error) {
    debug(`Cannot read directory ${dirPath}`)
  }
}

function debugDirectoryStructure (): void {
  info('\n=== Directory Structure ===')
  info(`Current working directory: ${process.cwd()}`)

  info('\n.pipeline directory:')
  const pipelineDir = path.join(process.cwd(), '.pipeline')
  if (existsSync(pipelineDir)) {
    printDirectoryTree(pipelineDir, '', 2, 0)
  } else {
    info('  (does not exist)')
  }

  info('\n.pipeline/commonPipelineEnvironment files:')
  const cpeDir = path.join(process.cwd(), '.pipeline', 'commonPipelineEnvironment')
  if (existsSync(cpeDir)) {
    printDirectoryTree(cpeDir, '', 3, 0)
  } else {
    info('  (does not exist)')
  }

  info('=== End Directory Structure ===\n')
}

/**
 * Creates a symbolic link to the parent .git directory when running from a subdirectory.
 * This enables piper steps (especially artifactPrepareVersion) to access the git repository.
 *
 * Background: The openGit() function in piper only looks for .git in the current directory,
 * not in parent directories like standard git tools. This is a workaround until upstream fix.
 *
 * @param workingDir - The working directory from action configuration (e.g., 'backend')
 */
function setupGitSymlink (workingDir: string): void {
  // Only create symlink if running from a subdirectory
  const isSubdirectory = workingDir !== '.' && workingDir !== ''

  if (!isSubdirectory) {
    debug('Running from root directory, no git symlink needed')
    return
  }

  try {
    // Paths relative to the subdirectory where piper will run
    const repoRoot = process.cwd()
    const subdirPath = path.join(repoRoot, workingDir)
    const gitSymlinkPath = path.join(subdirPath, '.git')
    const parentGitPath = path.join(repoRoot, '.git')

    debug(`Repository root: ${repoRoot}`)
    debug(`Subdirectory path: ${subdirPath}`)
    debug(`Git symlink target: ${gitSymlinkPath}`)
    debug(`Parent git location: ${parentGitPath}`)

    // Check if .git already exists in subdirectory
    if (existsSync(gitSymlinkPath)) {
      const stats = lstatSync(gitSymlinkPath)
      if (stats.isSymbolicLink()) {
        debug('.git symlink already exists in working directory')
        return
      } else {
        // Real .git directory exists in subdirectory - this is valid, don't create symlink
        debug('.git directory already exists in working directory (not a symlink)')
        return
      }
    }

    // Check if parent .git exists
    if (!existsSync(parentGitPath)) {
      warning(`Parent .git directory not found at ${parentGitPath} - git operations may fail`)
      return
    }

    // Create symlink from subdirectory to parent .git
    // Use relative path for the target so it works inside Docker containers
    const relativeGitPath = '..'
    info(`Creating symlink: ${gitSymlinkPath} -> ../.git`)
    symlinkSync(path.join(relativeGitPath, '.git'), gitSymlinkPath, 'dir')
    internalActionVariables.gitSymlinkCreated = true
    debug('Git symlink created successfully')
  } catch (error) {
    warning(`Failed to create .git symlink: ${error instanceof Error ? error.message : String(error)}`)
    warning('Piper steps requiring git access (e.g., artifactPrepareVersion) may fail')
  }
}

/**
 * Removes the .git symlink created by setupGitSymlink().
 * Called in the finally block to ensure cleanup even if the action fails.
 */
function cleanupGitSymlink (): void {
  if (!internalActionVariables.gitSymlinkCreated) {
    return
  }

  try {
    const workingDir = internalActionVariables.workingDir
    const repoRoot = process.cwd()
    const subdirPath = path.join(repoRoot, workingDir)
    const gitSymlinkPath = path.join(subdirPath, '.git')

    if (existsSync(gitSymlinkPath)) {
      const stats = lstatSync(gitSymlinkPath)
      if (stats.isSymbolicLink()) {
        info(`Removing git symlink: ${gitSymlinkPath}`)
        unlinkSync(gitSymlinkPath)
        debug('Git symlink removed successfully')
      } else {
        debug('Skipping .git removal - not a symlink')
      }
    }

    internalActionVariables.gitSymlinkCreated = false
  } catch (error) {
    warning(`Failed to remove .git symlink: ${error instanceof Error ? error.message : String(error)}`)
  }
}
