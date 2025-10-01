import * as cache from '@actions/cache'
import * as core from '@actions/core'
import fs from 'fs'
import { restoreDependencyCache, saveDependencyCache, generateCacheKey, getHashFiles } from '../src/cache'
import { BuildToolManager } from '../src/buildTools'

jest.mock('@actions/cache')
jest.mock('@actions/core')

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}))

describe('Cache', () => {
  beforeEach(() => {
    jest.spyOn(core, 'info').mockImplementation()
    jest.spyOn(core, 'debug').mockImplementation()
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  describe('restoreDependencyCache', () => {
    test('should restore cache when enabled and paths exist', async () => {
      const cacheKey = 'test-cache-key'
      jest.spyOn(cache, 'restoreCache').mockResolvedValue(cacheKey)

      await restoreDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: cacheKey,
        restoreKeys: ['test-restore-key']
      })

      expect(cache.restoreCache).toHaveBeenCalledWith(
        ['/cache/path'],
        cacheKey,
        ['test-restore-key']
      )
      expect(core.info).toHaveBeenCalledWith(`Cache restored from key: ${cacheKey}`)
    })

    test('should handle cache not found', async () => {
      jest.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)

      await restoreDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(core.info).toHaveBeenCalledWith('Cache not found')
    })

    test('should skip when disabled', async () => {
      await restoreDependencyCache({
        enabled: false,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(cache.restoreCache).not.toHaveBeenCalled()
      expect(core.debug).toHaveBeenCalledWith('Dependency caching is disabled or no paths specified')
    })

    test('should handle restore errors gracefully', async () => {
      jest.spyOn(cache, 'restoreCache').mockRejectedValue(new Error('Restore failed'))

      await restoreDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(core.debug).toHaveBeenCalledWith('Failed to restore cache: Error: Restore failed')
    })
  })

  describe('saveDependencyCache', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should save cache when enabled and paths exist', async () => {
      const cacheKey = 'test-cache-key'
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      jest.spyOn(cache, 'saveCache').mockResolvedValue(12345)

      await saveDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: cacheKey
      })

      expect(cache.saveCache).toHaveBeenCalledWith(['/cache/path'], cacheKey)
      expect(core.info).toHaveBeenCalledWith(`Saving cache with key: ${cacheKey}`)
      expect(core.info).toHaveBeenCalledWith('Cache saved successfully')
    })

    test('should skip when no paths exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false)

      await saveDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(cache.saveCache).not.toHaveBeenCalled()
      expect(core.debug).toHaveBeenCalledWith('No cache paths exist, skipping cache save')
    })

    test('should skip when disabled', async () => {
      await saveDependencyCache({
        enabled: false,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(cache.saveCache).not.toHaveBeenCalled()
      expect(core.debug).toHaveBeenCalledWith('Dependency caching is disabled or no paths specified')
    })

    test('should handle save errors gracefully', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      jest.spyOn(cache, 'saveCache').mockRejectedValue(new Error('Save failed'))

      await saveDependencyCache({
        enabled: true,
        paths: ['/cache/path'],
        key: 'test-cache-key'
      })

      expect(core.debug).toHaveBeenCalledWith('Failed to save cache: Error: Save failed')
    })
  })

  describe('generateCacheKey', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should generate basic key without hash files', () => {
      const key = generateCacheKey('test-base')
      expect(key).toMatch(/^test-base-\w+-\w+$/)
    })

    test('should generate key with hash from files', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      jest.spyOn(fs, 'readFileSync').mockReturnValue('file content')

      const key = generateCacheKey('test-base', undefined, ['package.json'])
      expect(key).toMatch(/^test-base-\w+-\w+-[a-f0-9]{16}$/)
    })

    test('should skip non-existent files when hashing', () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((path) => path === 'package.json')
      jest.spyOn(fs, 'readFileSync').mockReturnValue('file content')

      const key = generateCacheKey('test-base', undefined, ['package.json', 'missing.json'])
      expect(key).toMatch(/^test-base-\w+-\w+-[a-f0-9]{16}$/)
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('getHashFiles', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should return array of existing dependency files', () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
        return path === 'package.json' || path === 'pom.xml'
      })

      const files = getHashFiles()
      expect(files).toHaveLength(2)
      expect(files).toContain('package.json')
      expect(files).toContain('pom.xml')
    })

    test('should return empty array when no dependency files exist', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false)

      const files = getHashFiles()
      expect(files).toEqual([])
    })
  })

  describe('BuildToolManager', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should detect Go build tool for golangBuild step', () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
        return path === 'go.mod' || path === 'package.json'
      })

      const manager = new BuildToolManager()
      const buildTool = manager.detectBuildToolForStep('golangBuild')
      
      expect(buildTool).not.toBeNull()
      expect(buildTool?.name).toBe('go')
    })

    test('should fall back to generic detection for unknown steps', () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
        return path === 'pom.xml'
      })

      const manager = new BuildToolManager()
      const buildTool = manager.detectBuildToolForStep('unknownStep')
      
      expect(buildTool).not.toBeNull()
      expect(buildTool?.name).toBe('maven')
    })
  })
})
