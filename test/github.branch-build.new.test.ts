import fs from 'fs'
import { join } from 'path'
import { buildPiperFromBranch } from '../src/github'
import * as toolCache from '@actions/tool-cache'
import * as exec from '@actions/exec'
import * as core from '@actions/core'

jest.mock('@actions/tool-cache')
jest.mock('@actions/exec')
jest.mock('@actions/core')

const mockedExtractZip = toolCache.extractZip as jest.Mock
const mockedDownloadTool = toolCache.downloadTool as jest.Mock
const mockedExec = exec.exec as jest.Mock

describe('buildPiperFromBranch (open source)', () => {
  const owner = 'SAP'
  const repo = 'jenkins-library'
  const branch = 'feature/refactor-xyz/ABC'
  const shortSha = 'a1b2c3d' // Must match the SHA returned by git ls-remote mock

  beforeEach(() => {
    mockedDownloadTool.mockResolvedValue('archive.zip')
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, `${repo}-${branch}`)
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module github.com/SAP/jenkins-library')
      return target
    })
    mockedExec.mockImplementation(async () => 0)
  })

  afterEach(() => {
    jest.clearAllMocks()
    const baseDir = join(process.cwd(), `${owner}-${repo}-${shortSha}`)
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true })
    }
  })

  test('builds branch version and cleans extracted repositoryPath', async () => {
    mockedExec.mockImplementation(async (command: string, args?: string[], options?: any) => {
      if (command === 'git' && Array.isArray(args) && args[0] === 'ls-remote') {
        const listeners = options?.listeners
        if (listeners?.stdout !== undefined) {
          listeners.stdout(Buffer.from('a1b2c3d4e5f6789012345678901234567890abcd\trefs/heads/' + branch + '\n'))
        }
        return 0
      }
      return 0
    })

    const p = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    expect(p.endsWith('/piper')).toBe(true)
    expect(fs.existsSync(p)).toBe(true)
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Building Piper from'))

    const goBuildCalls = mockedExec.mock.calls.filter(call => call[0] === 'go' && call[1]?.[0] === 'build')
    expect(goBuildCalls.length).toBeGreaterThan(0)
    expect(goBuildCalls[0][1]).toEqual(expect.arrayContaining([
      'build',
      '-o',
      '../piper',
      '-ldflags',
      expect.stringContaining('GitCommit=')
    ]))
  })

  test('returns cached binary on second call', async () => {
    // Mock git ls-remote consistently
    mockedExec.mockImplementation(async (command: string, args?: string[], options?: any) => {
      if (command === 'git' && Array.isArray(args) && args[0] === 'ls-remote') {
        const listeners = options?.listeners
        if (listeners?.stdout !== undefined) {
          listeners.stdout(Buffer.from('a1b2c3d4e5f6789012345678901234567890abcd\trefs/heads/' + branch + '\n'))
        }
        return 0
      }
      return 0
    })

    const first = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    const callsAfterFirst = mockedExec.mock.calls.length

    const second = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    expect(second).toBe(first)

    const callsAfterSecond = mockedExec.mock.calls.length
    const secondCallCount = callsAfterSecond - callsAfterFirst

    expect(secondCallCount).toBe(1)

    const lastCall = mockedExec.mock.calls[mockedExec.mock.calls.length - 1]
    expect(lastCall[0]).toBe('git')
    expect(lastCall[1]).toEqual(expect.arrayContaining(['ls-remote']))
  })

  test('throws on empty branch', async () => {
    await expect(buildPiperFromBranch(`devel:${owner}:${repo}:`))
      .rejects.toThrow(/branch is empty|broken version/)
  })
})
