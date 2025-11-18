import * as fs from 'fs'
import { join } from 'path'
import { buildPiperFromSource, getTag, getDownloadUrlByTag } from '../src/github'
import * as toolCache from '@actions/tool-cache'
import * as exec from '@actions/exec'

jest.mock('@actions/tool-cache')
jest.mock('@actions/exec')
jest.mock('@octokit/core', () => ({
  Octokit: class {
    async request (): Promise<any> {
      // Simulate branch HEAD resolve returning SHA
      return { status: 200, data: { commit: { sha: 'abc1234def5678abc9012def3456abc7890def12' } } }
    }
  }
}))

const mockedDownloadTool = toolCache.downloadTool as jest.Mock
const mockedExtractZip = toolCache.extractZip as jest.Mock
const mockedExec = exec.exec as jest.Mock

describe('buildPiperFromSource branch mode', () => {
  const tempRoot = join(process.cwd(), 'tmp-test-github')
  const version = 'devel:SAP:jenkins-library:main'

  beforeEach(() => {
    mockedDownloadTool.mockResolvedValue('archive.zip')
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, 'jenkins-library-main')
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module github.com/SAP/jenkins-library')
    })
    mockedExec.mockResolvedValue(0)
  })

  afterEach(() => {
    jest.clearAllMocks()
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('builds and returns path (happy path)', async () => {
    const p = await buildPiperFromSource(version)
    expect(p.endsWith('/piper')).toBe(true)
    expect(fs.existsSync(p)).toBe(true) // binary created
    expect(mockedExec).toHaveBeenCalled()
  })

  test('uses cache on second invocation', async () => {
    const first = await buildPiperFromSource(version)
    const execCalls = mockedExec.mock.calls.length
    const second = await buildPiperFromSource(version)
    expect(second).toBe(first)
    expect(mockedExec.mock.calls.length).toBe(execCalls) // no extra build
  })

  test('throws on empty branch', async () => {
    await expect(buildPiperFromSource('devel:SAP:jenkins-library:'))
      .rejects.toThrow(/branch component is empty/)
  })
})

describe('getTag / getDownloadUrlByTag', () => {
  test('latest fallbacks', () => {
    expect(getTag('', true)).toBe('latest')
    expect(getDownloadUrlByTag('', true)).toMatch(/releases\/latest$/)
  })
  test('specific tag', () => {
    expect(getTag('v1.2.3', true)).toBe('tags/v1.2.3')
    expect(getDownloadUrlByTag('v1.2.3')).toMatch(/releases\/tag\/v1.2.3$/)
  })
})