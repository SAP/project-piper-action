import fs from 'fs'
import { join } from 'path'
import { buildPiperInnerSource, parseDevVersion, getVersionName } from '../src/build'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as toolCache from '@actions/tool-cache'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const mockedExec = exec.exec as jest.Mock
const mockedExtractZip = toolCache.extractZip as jest.Mock

describe('buildPiperInnerSource (branch mode)', () => {
  const owner = 'Org'
  const repo = 'my-repo'
  const branch = 'feature/X-123_add stuff'
  const version = `devel:${owner}:${repo}:${branch}`

  beforeEach(() => {
    process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.inner.example'

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

    const shortSha = 'a1b2c3d'
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, `${repo}-${shortSha}`)
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module inner/repo')
      return target
    })
    // Successful fetch (archive download)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8)
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
    const shortSha = 'a1b2c3d'
    const dirPath = join(process.cwd(), `${owner}-${repo}-${shortSha}`)
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true })
    }
  })

  test('builds binary from branch and removes extracted repositoryPath', async () => {
    const p = await buildPiperInnerSource(version, 'token123')
    expect(p.endsWith('/sap-piper')).toBe(true)
    expect(fs.existsSync(p)).toBe(true)
    const shortSha = 'a1b2c3d'
    const extractedDir = join(process.cwd(), `${owner}-${repo}-${shortSha}`, `${repo}-${shortSha}`)
    expect(fs.existsSync(extractedDir)).toBe(false)

    const goBuildCalls = mockedExec.mock.calls.filter(call => call[0] === 'go' && call[1]?.[0] === 'build')
    expect(goBuildCalls.length).toBeGreaterThan(0)
  })

  test('caches binary on second invocation', async () => {
    const first = await buildPiperInnerSource(version, 'token123')
    const callsAfterFirst = mockedExec.mock.calls.length

    const second = await buildPiperInnerSource(version, 'token123')
    expect(second).toBe(first)

    const callsAfterSecond = mockedExec.mock.calls.length
    const secondCallCount = callsAfterSecond - callsAfterFirst

    expect(secondCallCount).toBe(1)

    const lastCall = mockedExec.mock.calls[mockedExec.mock.calls.length - 1]
    expect(lastCall[0]).toBe('git')
    expect(lastCall[1]).toEqual(expect.arrayContaining(['ls-remote']))
  })

  test('fails early on empty branch', async () => {
    await expect(buildPiperInnerSource(`devel:${owner}:${repo}:`, 't1'))
      .rejects.toThrow(/broken version/)
  })

  test('token missing triggers setFailed and still attempts download', async () => {
    const p = await buildPiperInnerSource(version, '')
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/WDF GitHub Token/))
    expect(fs.existsSync(p)).toBe(true)
  })

  test('download failure path (response not ok) triggers error handling', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
    const p = await buildPiperInnerSource(version, 'token123')
    expect(fs.existsSync(p)).toBe(true)
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/Download failed/))
  })
})

describe('parseDevVersion & getVersionName (inner source)', () => {
  test('parseDevVersion returns branch', () => {
    const { owner, repository, branch } = parseDevVersion('devel:O:R:feat/test_branch')
    expect(owner).toBe('O')
    expect(repository).toBe('R')
    expect(branch).toBe('feat/test_branch')
  })

  test('getVersionName sanitizes separators & trims', () => {
    expect(getVersionName('  feat/A\\B  ')).toBe('feat-A-B')
  })
})
