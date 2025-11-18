import * as fs from 'fs'
import { join } from 'path'
import { buildPiperInnerSource, parseInnerDevBranchVersion } from '../src/build'
import * as exec from '@actions/exec'
import * as toolCache from '@actions/tool-cache'

jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
global.fetch = jest.fn()

const mockedExec = exec.exec as jest.Mock
const mockedExtractZip = toolCache.extractZip as jest.Mock

describe('parseInnerDevBranchVersion', () => {
  test('parses valid', () => {
    expect(parseInnerDevBranchVersion('devel:OrgX:repo-y:feature/abc'))
      .toEqual({ owner: 'OrgX', repository: 'repo-y', branch: 'feature/abc' })
  })
  test('rejects invalid prefix', () => {
    expect(() => parseInnerDevBranchVersion('dev:Org:repo:main')).toThrow(/expected prefix/)
  })
})

describe('buildPiperInnerSource', () => {
  beforeEach(() => {
    process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.example.corp'
    mockedExec.mockResolvedValue(0)
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      // simulate branch head resolve endpoint
      if (url.includes('/branches/')) {
        return Promise.resolve({
          ok: true,
            json: () => Promise.resolve({ commit: { sha: 'abcdef1234567890abcdef1234567890abcdef12' } })
        })
      }
      // archive fetch
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      })
    })
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, 'repo-main')
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module inner/repo')
      return target
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('builds branch mode binary', async () => {
    const path = await buildPiperInnerSource('devel:Org:repo:main', 'token123')
    expect(path.endsWith('/sap-piper')).toBe(true)
    expect(fs.existsSync(path)).toBe(true)
    expect(mockedExec).toHaveBeenCalled()
  })

  test('fails without token', async () => {
    await expect(buildPiperInnerSource('devel:Org:repo:main', ''))
      .rejects.toThrow(/missing WDF GitHub token/)
  })

  test('fallback to branch name when head resolve fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false }) // branch resolve fails
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
    })
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, 'repo-main')
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module inner/repo')
      return target
    })
    const path = await buildPiperInnerSource('devel:Org:repo:main', 'token123')
    expect(fs.existsSync(path)).toBe(true)
  })
})