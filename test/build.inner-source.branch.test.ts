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
  const sanitized = getVersionName(branch)

  beforeEach(() => {
    process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.inner.example'
    mockedExec.mockResolvedValue(0)
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, `${repo}-${sanitized}`)
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
    if (fs.existsSync(join(process.cwd(), `${owner}-${repo}-${sanitized}`))) {
      fs.rmSync(join(process.cwd(), `${owner}-${repo}-${sanitized}`), { recursive: true, force: true })
    }
  })

  test('builds binary from branch and removes extracted repositoryPath', async () => {
    const p = await buildPiperInnerSource(version, 'token123')
    expect(p.endsWith('/sap-piper')).toBe(true)
    expect(fs.existsSync(p)).toBe(true)
    // repositoryPath should be removed
    const extractedDir = join(process.cwd(), `${owner}-${repo}-${sanitized}`, `${repo}-${sanitized}`)
    expect(fs.existsSync(extractedDir)).toBe(false)
    expect(mockedExec).toHaveBeenCalledWith('go build -o ../sap-piper')
  })

  test('caches binary on second invocation', async () => {
    const first = await buildPiperInnerSource(version, 'token123')
    const execCalls = mockedExec.mock.calls.length
    const second = await buildPiperInnerSource(version, 'token123')
    expect(second).toBe(first)
    expect(mockedExec.mock.calls.length).toBe(execCalls)
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