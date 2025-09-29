import { debug, setFailed, info, startGroup, endGroup } from '@actions/core'
import { buildPiperFromSource } from './github'
import * as fs from 'fs'
import { executePiper } from './execute'
import { restoreDependencyCache, saveDependencyCache, generateCacheKey } from './cache'
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
    startGroup('Setup')
    info('Getting action configuration')
    const actionCfg: ActionConfiguration = await getActionConfig({ required: false })
    debug(`Action configuration: ${JSON.stringify(actionCfg)}`)

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

      // Setup cache directory for dependencies
      const cacheEnabled: boolean = true // enable by default for testing -> process.env.PIPER_ENABLE_CACHE === 'true'
      const cacheDir: string = process.env.RUNNER_TEMP !== undefined
        ? `${process.env.RUNNER_TEMP}/piper-cache`
        : '/tmp/piper-cache'
      if (cacheEnabled) {
        startGroup('Cache Restoration')
        // Create cache directory if it doesn't exist
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true })
        }
        // Set the cache directory environment variable for docker volume mounting
        process.env.PIPER_CACHE_DIR = cacheDir

        // Generate dependency-aware cache key based on pom.xml dependencies
        const dependencyFiles = ['pom.xml']
        const existingDepFiles = dependencyFiles.filter(file => fs.existsSync(file))

        if (existingDepFiles.length > 0) {
          // Use dependency-aware cache key
          const cacheKey: string = generateCacheKey(`piper-deps-${actionCfg.stepName}`, existingDepFiles)
          const restoreKeys: string[] = [
            generateCacheKey(`piper-deps-${actionCfg.stepName}`, []), // fallback without hash
            `piper-deps-${actionCfg.stepName}-${process.platform}-${process.arch}-`,
            `piper-deps-${actionCfg.stepName}-`
          ]

          info(`Attempting dependency cache restore with key: ${cacheKey}`)
          const beforeRestore = Date.now()

          // Check cache directory before restore
          const beforeCacheExists = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0
          debug(`Cache directory before restore - exists: ${fs.existsSync(cacheDir)}, populated: ${beforeCacheExists}`)

          await restoreDependencyCache({
            enabled: true,
            paths: [cacheDir],
            key: cacheKey,
            restoreKeys
          })

          const afterRestore = Date.now()
          const restoreTime = afterRestore - beforeRestore

          // Check if cache was actually restored by looking at cache directory contents
          const afterCacheExists = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0
          const cacheRestored = afterCacheExists && !beforeCacheExists

          // Set environment variables for Maven offline mode decision
          process.env.PIPER_CACHE_RESTORED = cacheRestored ? 'true' : 'false'
          process.env.PIPER_DEPENDENCIES_CHANGED = cacheRestored ? 'false' : 'true'

          debug(`Cache restore completed in ${restoreTime}ms`)
          debug(`Cache directory after restore - exists: ${fs.existsSync(cacheDir)}, populated: ${afterCacheExists}`)
          debug(`Cache was restored: ${cacheRestored}`)

          if (cacheRestored) {
            info('✅ Dependencies cache FOUND - Maven will run in OFFLINE mode')
          } else {
            info('❌ Dependencies cache MISS - Maven will download dependencies')
          }
        } else {
          // No dependency files found, use stable key
          const cacheKey: string = generateCacheKey(`piper-deps-${actionCfg.stepName}`, [])
          const restoreKeys: string[] = [
            `piper-deps-${actionCfg.stepName}-${process.platform}-${process.arch}-`,
            `piper-deps-${actionCfg.stepName}-`
          ]
          await restoreDependencyCache({
            enabled: true,
            paths: [cacheDir],
            key: cacheKey,
            restoreKeys
          })

          // Default to online mode for non-Maven projects
          process.env.PIPER_CACHE_RESTORED = 'false'
          process.env.PIPER_DEPENDENCIES_CHANGED = 'false'
        }
        endGroup()
      }

      await runContainers(actionCfg, contextConfig)

      startGroup(actionCfg.stepName)
      const result = await executePiper(actionCfg.stepName, flags)
      if (result.exitCode !== 0) {
        throw new Error(`Step ${actionCfg.stepName} failed with exit code ${result.exitCode}`)
      }
      endGroup()

      // Save cache after successful step execution - only if cache wasn't restored and directory has content
      const cacheWasRestored = process.env.PIPER_CACHE_RESTORED === 'true'
      const cacheDirHasContent = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0

      if (cacheEnabled && cacheDirHasContent && !cacheWasRestored) {
        startGroup('Cache Save')

        // Use same dependency-aware cache key for save as restore
        const dependencyFiles = ['pom.xml']
        const existingDepFiles = dependencyFiles.filter(file => fs.existsSync(file))
        const cacheKey = existingDepFiles.length > 0
          ? generateCacheKey(`piper-deps-${actionCfg.stepName}`, existingDepFiles)
          : generateCacheKey(`piper-deps-${actionCfg.stepName}`, [])

        info(`Saving dependencies cache with key: ${cacheKey}`)
        debug(`Cache directory has ${fs.readdirSync(cacheDir).length} items`)
        await saveDependencyCache({
          enabled: true,
          paths: [cacheDir],
          key: cacheKey
        })
        endGroup()
      } else if (cacheWasRestored) {
        info('Cache was restored - skipping cache save to avoid conflicts')
      } else if (!cacheDirHasContent) {
        info('Cache directory is empty - skipping cache save')
      }
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
  fs.chmodSync(piperPath, 0o775)
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
