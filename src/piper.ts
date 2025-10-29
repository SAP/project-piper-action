import { debug, setFailed, info, startGroup, endGroup } from '@actions/core'
import { buildPiperFromSource } from './github'
import { chmodSync, existsSync, cpSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from 'fs'
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

    // Fix CPE file extensions: writePipelineEnv creates files without .json extension,
    // but many Piper steps (sapDownloadArtifact, etc.) expect .json extension
    info('Normalizing CPE file extensions')
    normalizeCPEFileExtensions()

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

      debugDirectoryStructure('Before symlinking .pipeline folder', actionCfg.workingDir)

      info('Creating symlink to .pipeline folder in working directory')
      symlinkPipelineFolder(actionCfg.workingDir)

      debugDirectoryStructure('After symlinking .pipeline folder', actionCfg.workingDir)

      endGroup()
    }
    if (actionCfg.stepName !== '') {
      startGroup('Step Configuration')
      const flags = tokenize(actionCfg.flags)
      const contextConfig = await readContextConfig(actionCfg.stepName, flags)
      endGroup()

      await runContainers(actionCfg, contextConfig)

      debugDirectoryStructure('Before executing step', actionCfg.workingDir)

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()

      // No need to copy back - symlink keeps everything in sync!
      debugDirectoryStructure('After executing step', actionCfg.workingDir)
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

function printDirectoryTree (dirPath: string, prefix: string = '', maxDepth: number = 3, currentDepth: number = 0): void {
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
        debug(`Cannot access ${itemPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  } catch (error) {
    debug(`Cannot read directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function debugCPEFiles (): void {
  info('\n=== CPE (Common Pipeline Environment) Files ===')

  // Check ALL files in .pipeline/commonPipelineEnvironment recursively
  const cpeDir = path.join(process.cwd(), '.pipeline', 'commonPipelineEnvironment')
  if (existsSync(cpeDir)) {
    info('📁 .pipeline/commonPipelineEnvironment structure:')
    printDirectoryTree(cpeDir, '  ', 3, 0)
  } else {
    info('.pipeline/commonPipelineEnvironment does not exist')
  }

  // Check for CPE metadata files that piper creates
  const cpeFiles = [
    '.pipeline/commonPipelineEnvironment/custom/buildSettingsInfo.json',
    '.pipeline/commonPipelineEnvironment/custom/repositoryUrl.json',
    '.pipeline/commonPipelineEnvironment/custom/artifacts.json',
    '.pipeline/commonPipelineEnvironment/artifactVersion.json',
    '.pipeline/commonPipelineEnvironment/git/commitId.json',
    '.pipeline/commonPipelineEnvironment/golang/packageName.json',
    '.pipeline/commonPipelineEnvironment/golang/artifactId.json',
    '.pipeline/commonPipelineEnvironment/golang/goModulePath.json'
  ]

  info('\n📄 CPE File Contents:')
  cpeFiles.forEach(cpeFile => {
    const filePath = path.join(process.cwd(), cpeFile)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8')
        info(`  ${cpeFile}:`)
        info(`    ${content.trim()}`)
      } catch (err) {
        debug(`Cannot read ${cpeFile}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      debug(`  ${cpeFile}: NOT FOUND`)
    }
  })

  // Also check for url-log.json which contains artifact URLs
  const urlLogPath = path.join(process.cwd(), 'url-log.json')
  if (existsSync(urlLogPath)) {
    try {
      const content = readFileSync(urlLogPath, 'utf8')
      info('\n📄 url-log.json (artifact URLs):')
      const parsed = JSON.parse(content)
      info(`   ${JSON.stringify(parsed, null, 2)}`)
    } catch (err) {
      debug(`Cannot read url-log.json: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    info('\n📄 url-log.json: NOT FOUND')
  }

  info('=== End CPE Debug ===\n')
}

function debugDirectoryStructure (label: string, workingDir: string): void {
  info(`\n=== ${label} ===`)
  info(`Current working directory: ${process.cwd()}`)
  if (workingDir !== '.' && workingDir !== '') {
    info(`Target working directory: ${path.join(process.cwd(), workingDir)}`)
  }

  info('\nRoot directory tree:')
  const rootDir = process.cwd()
  if (existsSync(rootDir)) {
    printDirectoryTree(rootDir, '', 1, 0)
  } else {
    info('  (does not exist)')
  }

  info('\nRoot .pipeline directory:')
  const rootPipelineDir = path.join(process.cwd(), '.pipeline')
  if (existsSync(rootPipelineDir)) {
    printDirectoryTree(rootPipelineDir, '', 2, 0)
  } else {
    info('  (does not exist)')
  }

  if (workingDir !== '.' && workingDir !== '') {
    info(`\n${workingDir}/.pipeline directory:`)
    const targetPipelineDir = path.join(process.cwd(), workingDir, '.pipeline')
    if (existsSync(targetPipelineDir)) {
      printDirectoryTree(targetPipelineDir, '', 2, 0)
    } else {
      info('  (does not exist)')
    }

    info(`\n${workingDir} directory contents:`)
    const targetDir = path.join(process.cwd(), workingDir)
    if (existsSync(targetDir)) {
      printDirectoryTree(targetDir, '', 2, 0)
    } else {
      info('  (does not exist)')
    }
  }

  // Add CPE debugging
  debugCPEFiles()

  info('=== End Directory Debug ===\n')
}

/**
 * Creates a symlink from working directory to root .pipeline folder.
 * This avoids file copying and keeps everything synchronized automatically.
 */
function symlinkPipelineFolder (workingDir: string): void {
  // Only symlink if working directory is different from current directory
  if (workingDir === '.' || workingDir === '') {
    debug('Working directory is root, no symlink needed')
    return
  }

  const sourcePipelineDir = path.join(process.cwd(), '.pipeline')
  const targetPipelineDir = path.join(process.cwd(), workingDir, '.pipeline')

  // Check if source .pipeline folder exists
  if (!existsSync(sourcePipelineDir)) {
    debug('Source .pipeline folder does not exist, skipping symlink')
    return
  }

  info(`Creating symlink: ${targetPipelineDir} -> ${sourcePipelineDir}`)

  try {
    // Ensure target parent directory exists
    const targetParent = path.join(process.cwd(), workingDir)
    if (!existsSync(targetParent)) {
      mkdirSync(targetParent, { recursive: true })
    }

    // Remove existing .pipeline if it exists (might be a directory or symlink)
    if (existsSync(targetPipelineDir)) {
      const stats = statSync(targetPipelineDir)
      if (stats.isSymbolicLink() || stats.isDirectory()) {
        debug(`Removing existing .pipeline at ${targetPipelineDir}`)
        // Use rmSync with recursive for directories, unlinkSync for symlinks
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          // It's a real directory, need recursive removal
          rmSync(targetPipelineDir, { recursive: true, force: true })
        } else {
          // It's a symlink, just unlink it
          unlinkSync(targetPipelineDir)
        }
      }
    }

    // Create relative symlink (more portable than absolute)
    const relativeSource = path.relative(path.dirname(targetPipelineDir), sourcePipelineDir)
    symlinkSync(relativeSource, targetPipelineDir, 'dir')

    info('Symlink created successfully')
  } catch (error) {
    throw new Error(`Failed to create symlink for .pipeline folder: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Normalizes CPE file extensions by ensuring all JSON files have .json extension.
 * writePipelineEnv creates files without .json extension, but many Piper steps
 * (sapDownloadArtifact, etc.) expect .json extension.
 * This is a generic solution that works for all build tools (golang, maven, npm, python, etc.)
 *
 * @param workingDir - Optional working directory to normalize (defaults to root)
 */
function normalizeCPEFileExtensions (workingDir: string = '.'): void {
  const baseDir = workingDir === '.' || workingDir === '' ? process.cwd() : path.join(process.cwd(), workingDir)
  const cpeDir = path.join(baseDir, '.pipeline', 'commonPipelineEnvironment')

  if (!existsSync(cpeDir)) {
    debug(`CPE directory does not exist at ${cpeDir}, skipping normalization`)
    return
  }

  try {
    let filesNormalized = 0

    // Recursively scan all directories in CPE
    const scanDirectory = (dir: string): void => {
      const items = readdirSync(dir)

      items.forEach(item => {
        const itemPath = path.join(dir, item)
        const stat = statSync(itemPath)

        if (stat.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(itemPath)
        } else if (stat.isFile() && !item.endsWith('.json') && item !== 'artifactVersion' && item !== 'originalArtifactVersion') {
          // Found a file without .json extension
          // Check if the .json version already exists
          const jsonPath = `${itemPath}.json`

          if (!existsSync(jsonPath)) {
            try {
              // Try to read and validate it's JSON content
              const content = readFileSync(itemPath, 'utf8')
              JSON.parse(content) // Validate it's valid JSON

              // Copy the file with .json extension
              cpSync(itemPath, jsonPath)
              filesNormalized++
              debug(`Normalized: ${itemPath} -> ${jsonPath}`)
            } catch (err) {
              // Not a JSON file or invalid JSON, skip it
              debug(`Skipped non-JSON file: ${itemPath}`)
            }
          }
        }
      })
    }

    scanDirectory(cpeDir)

    if (filesNormalized > 0) {
      const location = workingDir === '.' || workingDir === '' ? 'root' : workingDir
      info(`Normalized ${filesNormalized} CPE file(s) in ${location} by adding .json extension`)
    } else {
      debug('No CPE files needed normalization')
    }
  } catch (error) {
    info(`Warning: Failed to normalize CPE file extensions: ${error instanceof Error ? error.message : String(error)}`)
  }
}

