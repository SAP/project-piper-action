import { debug, setFailed, info, startGroup, endGroup } from '@actions/core'
import { buildPiperFromSource } from './github'
import * as fs from 'fs'
import { executePiper } from './execute'
import { restoreDependencyCache, saveDependencyCache, generateCacheKey, saveBOMCache, restoreBOMCache, generateBOMCacheKey, generateDependencyHash } from './cache'
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

        // Use a stable cache key for testing - only changes with step name and platform
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
        endGroup()
      }

      // BOM caching optimization for mavenBuild step
      let bomCacheRestored = false
      if (actionCfg.stepName === 'mavenBuild' && cacheEnabled) {
        startGroup('BOM Cache Restoration')

        // Generate dependency hash for BOM cache key
        const dependencyHash = generateDependencyHash()
        const bomCacheKey = generateBOMCacheKey(`piper-bom-${actionCfg.stepName}`, dependencyHash)

        // Try to restore BOM files
        const bomPaths = ['target/bom-maven.xml', 'target/simple-bom-maven.xml']
        const bomRestoreKeys = [
          generateBOMCacheKey(`piper-bom-${actionCfg.stepName}`, ''),
          `piper-bom-${actionCfg.stepName}-${process.platform}-${process.arch}`
        ]

        bomCacheRestored = await restoreBOMCache(bomPaths, bomCacheKey, bomRestoreKeys)

        if (bomCacheRestored) {
          info('BOM files restored from cache, skipping BOM generation')
          // Set environment variable to potentially skip BOM generation in Piper
          process.env.PIPER_BOM_CACHE_RESTORED = 'true'
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

      // Save BOM cache after successful mavenBuild execution
      if (actionCfg.stepName === 'mavenBuild' && cacheEnabled && !bomCacheRestored) {
        startGroup('BOM Cache Save')

        // Generate dependency hash for BOM cache key
        const dependencyHash = generateDependencyHash()
        const bomCacheKey = generateBOMCacheKey(`piper-bom-${actionCfg.stepName}`, dependencyHash)

        // Save BOM files if they were generated
        const bomFiles = ['target/bom-maven.xml', 'target/simple-bom-maven.xml']
        await saveBOMCache(bomFiles, bomCacheKey)

        endGroup()
      }

      // Save cache after successful step execution
      if (cacheEnabled && fs.existsSync(cacheDir)) {
        startGroup('Cache Save')

        // Use same stable cache key for save as restore
        const cacheKey = generateCacheKey(`piper-deps-${actionCfg.stepName}`, [])
        await saveDependencyCache({
          enabled: true,
          paths: [cacheDir],
          key: cacheKey
        })
        endGroup()
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
