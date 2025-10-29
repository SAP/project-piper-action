import { debug, setFailed, info, startGroup, endGroup } from '@actions/core'
import { buildPiperFromSource } from './github'
import { chmodSync, existsSync, cpSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
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

      debugDirectoryStructure('Before copying .pipeline folder', actionCfg.workingDir)

      info('Copying .pipeline folder to working directory')
      copyPipelineFolder(actionCfg.workingDir)

      // Normalize CPE file extensions in the working directory too
      if (actionCfg.workingDir !== '.' && actionCfg.workingDir !== '') {
        info('Normalizing CPE file extensions in working directory')
        normalizeCPEFileExtensions(actionCfg.workingDir)
      }

      debugDirectoryStructure('After copying .pipeline folder', actionCfg.workingDir)

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

      info('Copying pipeline metadata back to root')
      copyBackPipelineMetadata(actionCfg.workingDir)

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

function copyBackPipelineMetadata (workingDir: string): void {
  // Only copy back if working directory is different from current directory
  if (workingDir === '.' || workingDir === '') {
    debug('Working directory is root, no need to copy metadata back')
    return
  }

  info(`Copying pipeline metadata from ${workingDir} back to root`)

  try {
    // Copy commonPipelineEnvironment back to root
    const sourceCPEDir = path.join(process.cwd(), workingDir, '.pipeline', 'commonPipelineEnvironment')
    const targetCPEDir = path.join(process.cwd(), '.pipeline', 'commonPipelineEnvironment')

    if (existsSync(sourceCPEDir)) {
      info('Copying commonPipelineEnvironment back to root')
      if (!existsSync(targetCPEDir)) {
        mkdirSync(targetCPEDir, { recursive: true })
      }
      cpSync(sourceCPEDir, targetCPEDir, { recursive: true, force: true })
      debug(`Copied: ${sourceCPEDir} -> ${targetCPEDir}`)
    } else {
      debug(`Source CPE directory does not exist: ${sourceCPEDir}`)
    }

    // Copy url-log.json back to root (contains artifact URLs)
    const sourceUrlLog = path.join(process.cwd(), workingDir, 'url-log.json')
    const targetUrlLog = path.join(process.cwd(), 'url-log.json')

    if (existsSync(sourceUrlLog)) {
      info('Copying url-log.json back to root')
      cpSync(sourceUrlLog, targetUrlLog, { force: true })
      debug(`Copied: ${sourceUrlLog} -> ${targetUrlLog}`)
    } else {
      debug(`url-log.json does not exist in ${workingDir}`)
    }

    // Copy stepReports back to root
    const sourceReportsDir = path.join(process.cwd(), workingDir, '.pipeline', 'stepReports')
    const targetReportsDir = path.join(process.cwd(), '.pipeline', 'stepReports')

    if (existsSync(sourceReportsDir)) {
      info('Copying stepReports back to root')
      if (!existsSync(targetReportsDir)) {
        mkdirSync(targetReportsDir, { recursive: true })
      }
      cpSync(sourceReportsDir, targetReportsDir, { recursive: true, force: true })
      debug(`Copied: ${sourceReportsDir} -> ${targetReportsDir}`)
    } else {
      debug(`stepReports directory does not exist in ${workingDir}`)
    }

    // Synthesize missing golang CPE metadata if needed (piper bug workaround for monorepo)
    synthesizeGolangCPEIfMissing(workingDir)

    info('Pipeline metadata copied back successfully')
  } catch (error) {
    throw new Error(`Failed to copy pipeline metadata back: ${error instanceof Error ? error.message : String(error)}`)
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

function synthesizeGolangCPEIfMissing (workingDir: string): void {
  const golangCPEDir = path.join(process.cwd(), '.pipeline', 'commonPipelineEnvironment', 'golang')

  // Check if golang CPE metadata files exist with .json extension (required by sapDownloadArtifact)
  const packageNameFile = path.join(golangCPEDir, 'packageName.json')
  const goModulePathFile = path.join(golangCPEDir, 'goModulePath.json')
  const artifactIdFile = path.join(golangCPEDir, 'artifactId.json')

  if (existsSync(packageNameFile) && existsSync(goModulePathFile) && existsSync(artifactIdFile)) {
    debug('Golang CPE metadata already exists with correct extensions')
    return
  }

  info('Golang CPE metadata missing or incomplete - synthesizing')

  try {
    // First, try to read from pipeline environment JSON
    let modulePath: string | undefined
    let artifactId: string | undefined

    if (process.env.PIPER_ACTION_PIPELINE_ENV !== undefined) {
      try {
        const pipelineEnv = JSON.parse(process.env.PIPER_ACTION_PIPELINE_ENV)
        modulePath = pipelineEnv['golang/packageName'] ?? pipelineEnv['golang/goModulePath']
        artifactId = pipelineEnv['golang/artifactId']
        debug(`Found golang metadata in pipeline env: modulePath=${modulePath}, artifactId=${artifactId}`)
      } catch (err) {
        debug('Could not parse pipeline environment JSON')
      }
    }

    // If not in pipeline env, check if files exist without .json extension (created by writePipelineEnv)
    if (modulePath === undefined || artifactId === undefined) {
      const packageNameFileNoExt = path.join(golangCPEDir, 'packageName')
      const artifactIdFileNoExt = path.join(golangCPEDir, 'artifactId')

      if (existsSync(packageNameFileNoExt) && existsSync(artifactIdFileNoExt)) {
        modulePath = JSON.parse(readFileSync(packageNameFileNoExt, 'utf8'))
        artifactId = JSON.parse(readFileSync(artifactIdFileNoExt, 'utf8'))
        info('Found golang metadata in files without .json extension')
      }
    }

    // If still not found, try to read from go.mod
    if (modulePath === undefined || artifactId === undefined) {
      const goModPath = path.join(process.cwd(), workingDir, 'go.mod')
      if (!existsSync(goModPath)) {
        debug(`go.mod not found at ${goModPath}`)
        return
      }

      const goModContent = readFileSync(goModPath, 'utf8')
      const moduleMatch = goModContent.match(/^module\s+(.+)$/m)
      if (!moduleMatch) {
        debug('Could not extract module path from go.mod')
        return
      }

      modulePath = moduleMatch[1].trim()
      artifactId = path.basename(modulePath)
      info(`Detected Go module from go.mod: ${modulePath}, artifact: ${artifactId}`)
    }

    // Create golang CPE directory at root if it doesn't exist
    if (!existsSync(golangCPEDir)) {
      mkdirSync(golangCPEDir, { recursive: true })
    }

    // Write golang CPE files with .json extension (required by sapDownloadArtifact)
    writeFileSync(packageNameFile, JSON.stringify(modulePath), 'utf8')
    writeFileSync(goModulePathFile, JSON.stringify(modulePath), 'utf8')
    writeFileSync(artifactIdFile, JSON.stringify(artifactId), 'utf8')

    info('Golang CPE metadata synthesized successfully')
  } catch (error) {
    info(`Warning: Failed to synthesize golang CPE metadata: ${error instanceof Error ? error.message : String(error)}`)
  }
}
