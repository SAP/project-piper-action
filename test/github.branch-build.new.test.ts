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
  const sanitized = branch
    .replace(/[^0-9A-Za-z._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)

  beforeEach(() => {
    mockedDownloadTool.mockResolvedValue('archive.zip')
    mockedExtractZip.mockImplementation(async (_zip: string, target: string) => {
      const repoDir = join(target, `${repo}-${sanitized}`)
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(join(repoDir, 'go.mod'), 'module github.com/SAP/jenkins-library')
      return target
    })
    mockedExec.mockImplementation(async () => 0)
  })

  afterEach(() => {
    jest.clearAllMocks()
    const baseDir = join(process.cwd(), `${owner}-${repo}-${sanitized}`)
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true })
    }
  })

  test('builds branch version and cleans extracted repositoryPath', async () => {
    const p = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    expect(p.endsWith('/piper')).toBe(true)
    expect(fs.existsSync(p)).toBe(true)
    const extractedDir = join(process.cwd(), `${owner}-${repo}-${sanitized}`, `${repo}-${sanitized}`)
    expect(fs.existsSync(extractedDir)).toBe(false)
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Building Piper from'))
    expect(mockedExec).toHaveBeenCalledWith(
      'go build -o ../piper',
      expect.arrayContaining([
        '-ldflags',
        expect.stringContaining(`GitCommit=${branch}`)
      ])
    )
  })

  test('returns cached binary on second call', async () => {
    const first = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    const execCalls = mockedExec.mock.calls.length
    const second = await buildPiperFromBranch(`devel:${owner}:${repo}:${branch}`)
    expect(second).toBe(first)
    expect(mockedExec.mock.calls.length).toBe(execCalls)
  })

  test('throws on empty branch', async () => {
    await expect(buildPiperFromBranch(`devel:${owner}:${repo}:`))
      .rejects.toThrow(/branch is empty|broken version/)
  })
})
