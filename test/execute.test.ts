import * as exec from '@actions/exec'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import fs from 'fs'
import { executePiper } from '../src/execute'
import { restoreDependencyCache, saveDependencyCache, generateCacheKey } from '../src/cache'
import { internalActionVariables } from '../src/piper'

jest.mock('@actions/exec')
jest.mock('@actions/cache')
jest.mock('@actions/core')

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  chmodSync: jest.fn()
}))

describe('Execute', () => {
  const piperPath = './piper'
  const expectedOptions = { ignoreReturnCode: true }
  // The workflow runs in a job named 'units' and it's appended with '--stageName' to a Piper call,
  // therefore to pass tests locally as well, the env var is set
  const githubJob = process.env.GITHUB_JOB
  const stageNameArg = ['--stageName', 'units']

  beforeEach(() => {
    jest.spyOn(exec, 'getExecOutput').mockReturnValue(Promise.resolve({ stdout: 'testout', stderr: 'testerr', exitCode: 0 }))

    process.env.GITHUB_JOB = stageNameArg[1]

    internalActionVariables.piperBinPath = piperPath
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    process.env.GITHUB_JOB = githubJob

    internalActionVariables.sidecarNetworkID = ''
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.sidecarContainerID = ''
  })

  test('Execute Piper without flags', async () => {
    const stepName = 'version'

    const piperExec = await executePiper(stepName)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container without flags', async () => {
    const stepName = 'version'
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, undefined)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })
})

describe('Dependency Cache', () => {
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
})
