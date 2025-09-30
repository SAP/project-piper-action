import { debug, endGroup, info, startGroup } from '@actions/core'
import fs from 'fs'
import { restoreCache, saveCache } from '@actions/cache'
import crypto from 'crypto'

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

export function generateCacheKey (baseName: string, hashFiles?: string[]): string {
  let key = `${baseName}-${process.platform}-${process.arch}`
  if (hashFiles === undefined || hashFiles.length === 0) {
    return key
  }
  const hash = crypto.createHash('sha256')
  for (const file of hashFiles) {
    if (!fs.existsSync(file)) continue

    let content: string = fs.readFileSync(file, 'utf8')
    // For pom.xml, only hash the dependencies section to avoid cache misses
    // from unrelated changes like version bumps, descriptions, etc.
    if (file.endsWith('pom.xml')) {
      const dependenciesMatch: RegExpMatchArray | null = content.match(/<dependencies>[\s\S]*?<\/dependencies>/g)
      if (dependenciesMatch !== null) {
        content = dependenciesMatch.join('')
      }
    }

    hash.update(content)
  }
  key += `-${hash.digest('hex').substring(0, 16)}`
  return key
}

export function getHashFiles (): string[] {
  const dependencyFiles = ['package.json', 'pom.xml', 'build.gradle', 'requirements.txt', 'go.mod']
  return dependencyFiles.filter(file => fs.existsSync(file))
}
export async function saveCachedDependencies (stepName: string, cacheDir: string): Promise<void> {
  // Save cache after successful step execution - only if cache wasn't restored and directory has content
  const cacheDirHasContent = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0

  if (process.env.PIPER_CACHE_RESTORED === 'true') {
    info('Cache was restored - skipping cache save to avoid conflicts')
    return
  }
  if (!cacheDirHasContent) {
    info('Cache directory is empty - skipping cache save')
    return
  }
  startGroup('Cache Save')

  // Use same dependency-aware cache key for save as restore
  const dependencyFiles = ['pom.xml']
  const existingDepFiles = dependencyFiles.filter(file => fs.existsSync(file))
  const cacheKey = existingDepFiles.length > 0
    ? generateCacheKey(`piper-deps-${stepName}`, existingDepFiles)
    : generateCacheKey(`piper-deps-${stepName}`, [])

  info(`Saving dependencies cache with key: ${cacheKey}`)
  debug(`Cache directory has ${fs.readdirSync(cacheDir).length} items`)

  await saveDependencyCache({
    enabled: true,
    paths: [cacheDir],
    key: cacheKey
  })
  endGroup()
}

export async function restoreCachedDependencies (stepName: string, cacheDir: string): Promise<void> {
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
    // Use dependency-aware cache key based only on dependencies hash
    const cacheKey = generateCacheKey(`piper-deps-${stepName}`, existingDepFiles)

    info(`Attempting dependency cache restore with key: ${cacheKey}`)

    // Check cache directory before restore
    const beforeCacheExists = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0
    debug(`Cache directory before restore - exists: ${fs.existsSync(cacheDir)}, populated: ${beforeCacheExists}`)

    await restoreDependencyCache({
      enabled: true,
      paths: [cacheDir],
      key: cacheKey
    })

    // Check if cache was actually restored by looking at cache directory contents
    const cacheRestored = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0 && !beforeCacheExists

    // On cache miss, ensure clean state by removing any stale cache data
    if (!cacheRestored && fs.existsSync(cacheDir)) {
      const cacheContents = fs.readdirSync(cacheDir)
      if (cacheContents.length > 0) {
        info('🧹 Cleaning stale cache data for fresh dependency download')
        // Remove all contents but keep the directory
        cacheContents.forEach(item => {
          const itemPath = `${cacheDir}/${item}`
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

    // Set environment variables for Maven offline mode decision
    process.env.PIPER_CACHE_RESTORED = cacheRestored ? 'true' : 'false'
    process.env.PIPER_DEPENDENCIES_CHANGED = cacheRestored ? 'false' : 'true'

    debug(`Cache directory after restore - exists: ${fs.existsSync(cacheDir)}, populated: ${fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0}`)
    debug(`Cache was restored: ${cacheRestored}`)

    if (cacheRestored) {
      info('✅ Dependencies cache FOUND - Maven will run in OFFLINE mode')
    } else {
      info('❌ Dependencies cache MISS - Maven will download ALL dependencies fresh')
    }
  } else {
    // No dependency files found, use stable key
    const cacheKey: string = generateCacheKey(`piper-deps-${stepName}`, [])
    await restoreDependencyCache({
      enabled: true,
      paths: [cacheDir],
      key: cacheKey
    })

    // Default to online mode for non-Maven projects
    process.env.PIPER_CACHE_RESTORED = 'false'
    process.env.PIPER_DEPENDENCIES_CHANGED = 'false'
  }
  endGroup()
}
