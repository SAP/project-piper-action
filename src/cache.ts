import { debug, info } from '@actions/core'
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

  try {
    info(`Attempting to restore cache with key: ${cacheConfig.key}`)
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
  if (hashFiles !== undefined && hashFiles.length > 0) {
    const hash = crypto.createHash('sha256')
    for (const file of hashFiles) {
      if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8')

        // For pom.xml, only hash the dependencies section to avoid cache misses
        // from unrelated changes like version bumps, descriptions, etc.
        if (file.endsWith('pom.xml')) {
          const dependenciesMatch = content.match(/<dependencies>[\s\S]*?<\/dependencies>/g)
          if (dependenciesMatch !== null) {
            content = dependenciesMatch.join('')
          }
        }

        hash.update(content)
      }
    }
    key += `-${hash.digest('hex').substring(0, 16)}`
  }
  return key
}

export function getHashFiles (): string[] {
  const dependencyFiles = ['package.json', 'pom.xml', 'build.gradle', 'requirements.txt', 'Gemfile']
  return dependencyFiles.filter(file => fs.existsSync(file))
}

export async function saveBOMCache (bomFiles: string[], cacheKey: string): Promise<void> {
  try {
    // Check if BOM files exist
    const existingBOMFiles = bomFiles.filter(file => fs.existsSync(file))
    if (existingBOMFiles.length === 0) {
      debug('No BOM files found, skipping BOM cache save')
      return
    }

    info(`Saving BOM cache with key: ${cacheKey}`)
    await saveCache(existingBOMFiles, `bom-${cacheKey}`)
    info('BOM cache saved successfully')
  } catch (error) {
    debug(`Failed to save BOM cache: ${String(error)}`)
  }
}

export async function restoreBOMCache (bomPaths: string[], cacheKey: string, restoreKeys?: string[]): Promise<boolean> {
  try {
    info(`Attempting to restore BOM cache with key: bom-${cacheKey}`)
    const restoredKey = await restoreCache(
      bomPaths,
      `bom-${cacheKey}`,
      restoreKeys?.map(key => `bom-${key}`)
    )

    if (restoredKey !== undefined) {
      info(`BOM cache restored from key: ${restoredKey}`)
      return true
    } else {
      info('BOM cache not found')
      return false
    }
  } catch (error) {
    debug(`Failed to restore BOM cache: ${String(error)}`)
    return false
  }
}

export function generateBOMCacheKey (baseName: string, dependencyHash?: string): string {
  let key = `${baseName}-${process.platform}-${process.arch}`
  if (dependencyHash !== undefined && dependencyHash !== '') {
    key += `-${dependencyHash}`
  }
  return key
}

export function generateDependencyHash (pomFiles?: string[]): string {
  const hash = crypto.createHash('sha256')

  // Default to finding pom.xml files if not provided
  const filesToHash = pomFiles ?? (fs.existsSync('pom.xml') ? ['pom.xml'] : [])

  for (const file of filesToHash) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8')

      // Only hash dependencies, plugins, and build configuration that affects BOM
      const relevantSections = [
        /<dependencies>[\s\S]*?<\/dependencies>/g,
        /<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g,
        /<plugins>[\s\S]*?<\/plugins>/g,
        /<pluginManagement>[\s\S]*?<\/pluginManagement>/g
      ]

      let combinedContent = ''
      for (const sectionRegex of relevantSections) {
        const matches = content.match(sectionRegex)
        if (matches !== null) {
          combinedContent += matches.join('')
        }
      }

      if (combinedContent !== '') {
        hash.update(combinedContent)
      } else {
        // Fallback to entire file if no sections found
        hash.update(content)
      }
    }
  }

  return hash.digest('hex').substring(0, 16)
}
