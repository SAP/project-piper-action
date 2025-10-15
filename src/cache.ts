import { debug, endGroup, info, startGroup } from '@actions/core'
import fs from 'fs'
import { restoreCache, saveCache } from '@actions/cache'
import crypto from 'crypto'
import { BuildToolManager, type BuildTool } from './buildTools'

interface CacheConfig {
  enabled: boolean
  paths: string[]
  key: string
  restoreKeys?: string[]
}

export async function saveDependencyCache (cacheConfig?: CacheConfig): Promise<void> {
  if (cacheConfig?.enabled !== true || cacheConfig.paths.length === 0) {
    debug('Dependency caching is disabled or no paths specified')
    return
  }

  try {
    // Check if all cache paths exist
    const existingPaths = cacheConfig.paths.filter(p => fs.existsSync(p))
    if (existingPaths.length === 0) {
      debug('No cache paths exist, skipping cache save')
      return
    }

    info(`Saving cache with key: ${cacheConfig.key}`)
    await saveCache(existingPaths, cacheConfig.key)
    info('Cache saved successfully')
  } catch (error) {
    debug(`Failed to save cache: ${String(error)}`)
  }
}

export async function restoreDependencyCache (cacheConfig?: CacheConfig): Promise<void> {
  if (cacheConfig?.enabled !== true || cacheConfig.paths.length === 0) {
    debug('Dependency caching is disabled or no paths specified')
    return
  }

  info(`Attempting to restore cache with key: ${cacheConfig.key}`)
  try {
    const cacheKey: string | undefined = await restoreCache(
      cacheConfig.paths,
      cacheConfig.key,
      cacheConfig.restoreKeys
    )

    info(cacheKey !== undefined ? `Cache restored from key: ${cacheKey}` : 'Cache not found')
  } catch (error) {
    debug(`Failed to restore cache: ${String(error)}`)
  }
}

export function generateCacheKey (baseName: string, buildTool?: BuildTool, hashFiles?: string[]): string {
  let key = `${baseName}-${process.platform}-${process.arch}`
  if (hashFiles === undefined || hashFiles.length === 0) {
    return key
  }
  const hash = crypto.createHash('sha256')
  for (const file of hashFiles) {
    if (!fs.existsSync(file)) continue

    let content: string
    if (buildTool !== undefined) {
      content = buildTool.extractDependencyContent(file)
    } else {
      content = fs.readFileSync(file, 'utf8')
    }

    hash.update(content)
  }
  key += `-${hash.digest('hex').substring(0, 16)}`
  return key
}

export function getHashFiles (): string[] {
  const manager = new BuildToolManager()
  return manager.getAllDependencyFiles()
}
export async function saveCachedDependencies (stepName: string, cacheDir?: string): Promise<void> {
  const manager = new BuildToolManager()
  const buildTool = manager.detectBuildToolForStep(stepName)

  // If cacheDir is provided and buildTool is detected, create a subdirectory for the tool
  const actualCacheDir = buildTool !== null && cacheDir !== undefined
    ? `${cacheDir}/${buildTool.cachePath}`
    : cacheDir ?? buildTool?.cachePath ?? '.cache'
  // Save cache after successful step execution - only if cache wasn't restored and directory has content
  const cacheDirHasContent = fs.existsSync(actualCacheDir) && fs.readdirSync(actualCacheDir).length > 0

  if (process.env.PIPER_CACHE_RESTORED === 'true') {
    info('Cache was restored - skipping cache save to avoid conflicts')
    return
  }
  if (!cacheDirHasContent) {
    info('Cache directory is empty - skipping cache save')
    return
  }
  startGroup('Cache Save')

  let cacheKey: string
  if (buildTool !== null) {
    const depFiles = buildTool.getDependencyFiles()
    const toolPrefix = `piper-${buildTool.name}-deps-${stepName}`
    cacheKey = depFiles.length > 0
      ? generateCacheKey(toolPrefix, buildTool, depFiles)
      : generateCacheKey(toolPrefix)
    info(`Saving ${buildTool.name} dependencies cache with key: ${cacheKey}`)
  } else {
    cacheKey = generateCacheKey(`piper-deps-${stepName}`)
    info(`Saving generic dependencies cache with key: ${cacheKey}`)
  }

  debug(`Cache directory has ${fs.readdirSync(actualCacheDir).length} items`)

  await saveDependencyCache({
    enabled: true,
    paths: [actualCacheDir],
    key: cacheKey
  })
  endGroup()
}

export async function restoreCachedDependencies (stepName: string, cacheDir?: string): Promise<void> {
  startGroup('Cache Restoration')

  const manager = new BuildToolManager()
  const buildTool = manager.detectBuildToolForStep(stepName)

  // If cacheDir is provided and buildTool is detected, create a subdirectory for the tool
  const actualCacheDir = buildTool !== null && cacheDir !== undefined
    ? `${cacheDir}/${buildTool.cachePath}`
    : cacheDir ?? buildTool?.cachePath ?? '.cache'
  // Create cache directory if it doesn't exist
  if (!fs.existsSync(actualCacheDir)) {
    fs.mkdirSync(actualCacheDir, { recursive: true })
  }

  // Set the cache directory and build tool environment variables for docker volume mounting
  process.env.PIPER_CACHE_DIR = actualCacheDir
  if (buildTool !== null) {
    process.env.PIPER_BUILD_TOOL = buildTool.name
  }

  if (buildTool !== null) {
    const depFiles = buildTool.getDependencyFiles()

    if (depFiles.length > 0) {
      const toolPrefix = `piper-${buildTool.name}-deps-${stepName}`
      const cacheKey = generateCacheKey(toolPrefix, buildTool, depFiles)

      info(`Attempting ${buildTool.name} dependency cache restore with key: ${cacheKey}`)

      // Check cache directory before restore
      const beforeCacheExists = fs.existsSync(actualCacheDir) && fs.readdirSync(actualCacheDir).length > 0
      debug(`Cache directory before restore - exists: ${fs.existsSync(actualCacheDir)}, populated: ${beforeCacheExists}`)

      await restoreDependencyCache({
        enabled: true,
        paths: [actualCacheDir],
        key: cacheKey
      })

      // Check if cache was actually restored by looking at cache directory contents
      const cacheRestored = fs.existsSync(actualCacheDir) && fs.readdirSync(actualCacheDir).length > 0 && !beforeCacheExists

      // On cache miss, ensure clean state by removing any stale cache data
      if (!cacheRestored && fs.existsSync(actualCacheDir)) {
        const cacheContents = fs.readdirSync(actualCacheDir)
        if (cacheContents.length > 0) {
          info('🧹 Cleaning stale cache data for fresh dependency download')
          // Remove all contents but keep the directory
          cacheContents.forEach(item => {
            const itemPath = `${actualCacheDir}/${item}`
            try {
              if (fs.statSync(itemPath).isDirectory()) {
                fs.rmSync(itemPath, { recursive: true })
              } else {
                fs.unlinkSync(itemPath)
              }
            } catch (error) {
              debug(`Failed to clean cache item ${item}: ${error instanceof Error ? error.message : String(error)}`)
            }
          })
        }
      }

      // Set environment variables based on build tool
      const cacheEnvVars = buildTool.getCacheEnvironmentVariables(cacheRestored, !cacheRestored)
      for (const [key, value] of Object.entries(cacheEnvVars)) {
        process.env[key] = value
      }

      debug(`Cache directory after restore - exists: ${fs.existsSync(actualCacheDir)}, populated: ${fs.existsSync(actualCacheDir) && fs.readdirSync(actualCacheDir).length > 0}`)
      debug(`Cache was restored: ${cacheRestored}`)

      if (cacheRestored) {
        info(`✅ Dependencies cache FOUND for ${buildTool.name}`)
      } else {
        info(`❌ Dependencies cache MISS for ${buildTool.name} - will download ALL dependencies fresh`)
      }
    } else {
      info(`No dependency files found for ${buildTool.name} - skipping cache`)
      process.env.PIPER_CACHE_RESTORED = 'false'
      process.env.PIPER_DEPENDENCIES_CHANGED = 'false'
    }
  } else {
    // No build tool detected, use generic cache
    const cacheKey: string = generateCacheKey(`piper-deps-${stepName}`)
    info('No specific build tool detected - using generic cache')

    await restoreDependencyCache({
      enabled: true,
      paths: [actualCacheDir],
      key: cacheKey
    })

    process.env.PIPER_CACHE_RESTORED = 'false'
    process.env.PIPER_DEPENDENCIES_CHANGED = 'false'
  }
  endGroup()
}
