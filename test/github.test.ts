import fs from 'fs'

import * as toolCache from '@actions/tool-cache'
import * as octokit from '@octokit/core'
import * as core from '@actions/core'

import { buildPiperFromBranch } from '../src/github'
import { downloadPiperBinary } from '../src/download'
import { parseDevVersion, getVersionName } from '../src/build'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('@octokit/core')
jest.mock('node-fetch')

describe('GitHub package tests', () => {
  const version = 'v1.1.1'
  const osStep = 'version'
  const sapStep = 'sapSomeStep'
  const githubApiURL = 'https://github.acme.com/api/v3'
  const token = 'someToken'
  const owner = 'someOwner'
  const repo = 'SomeRepo'
  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  test('downloadPiperBinary - inner source piper, no token', async () => {
    try {
      await downloadPiperBinary(sapStep, '', 'latest', githubApiURL, '', owner, repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('Token is not provided for enterprise step'))
    }
  })

  test('downloadPiperBinary - no owner', async () => {
    try {
      await downloadPiperBinary(sapStep, '', 'latest', githubApiURL, token, '', repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('owner is not provided'))
    }
  })

  test('downloadPiperBinary - no repo', async () => {
    try {
      await downloadPiperBinary(sapStep, '', 'latest', githubApiURL, token, owner, '')
    } catch (e) {
      expect(e).toStrictEqual(Error('repository is not provided'))
    }
  })

  test('downloadPiperBinary - OS step latest, no token', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        status: 200,
        url: 'https://github.com/SAP/jenkins-library/releases/tag/v1.1.1'
      } as unknown as Response
    })

    await downloadPiperBinary(osStep, '', 'latest', githubApiURL, '', owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'version: latest')
    expect(core.debug).toHaveBeenNthCalledWith(2, 'Fetching binary from URL')
    expect(core.debug).toHaveBeenCalledTimes(4)
    expect(core.info).toHaveBeenCalledWith(`Downloading 'https://github.com/SAP/jenkins-library/releases/download/v1.1.1/piper' as '${process.cwd()}/${version.replace(/\./g, '_')}/piper'`)
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  test('downloadPiperBinary - SAP step latest', async () => {
    const assetUrl = `${githubApiURL}/release/assets/123456`
    jest.spyOn(octokit, 'Octokit').mockImplementationOnce(() => {
      return {
        request: async () => {
          return {
            data: {
              tag_name: version,
              assets: [{ name: 'sap-piper', url: assetUrl }]
            },
            status: 200
          }
        }
      } as unknown as octokit.Octokit
    })

    await downloadPiperBinary(sapStep, '', 'latest', githubApiURL, token, owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'version: latest')
    expect(core.debug).toHaveBeenNthCalledWith(2, 'Fetching binary from GitHub API')
    expect(core.debug).toHaveBeenNthCalledWith(3, 'Using latest tag')
    expect(core.debug).toHaveBeenNthCalledWith(4, `Fetching release info from ${githubApiURL}/repos/${owner}/${repo}/releases/latest`)
    expect(core.debug).toHaveBeenNthCalledWith(5, `Found assets: [{"name":"sap-piper","url":"${assetUrl}"}]`)
    expect(core.debug).toHaveBeenNthCalledWith(6, 'Found tag: v1.1.1')
    expect(core.debug).toHaveBeenNthCalledWith(7, `Found asset URL: ${assetUrl} and tag: ${version}`)
    expect(core.debug).toHaveBeenCalledTimes(8)
    expect(core.info).toHaveBeenNthCalledWith(1, expect.stringContaining(`Downloading '${assetUrl}' as '${process.cwd()}/${version.replace(/\./g, '_')}/sap-piper'`))
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  test('downloadPiperBinary - OS step, exact version', async () => {
    const assetUrl = `${githubApiURL}/release/assets/123456`
    jest.spyOn(octokit, 'Octokit').mockImplementationOnce(() => {
      return {
        request: async () => {
          return {
            data: {
              tag_name: version,
              assets: [{ name: 'piper', url: assetUrl }]
            },
            status: 200
          }
        }
      } as unknown as octokit.Octokit
    })

    await downloadPiperBinary(osStep, '', version, githubApiURL, token, owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'version: v1.1.1')
    expect(core.debug).toHaveBeenNthCalledWith(2, 'Fetching binary from GitHub API')
    expect(core.debug).toHaveBeenNthCalledWith(3, 'getTag returns: tags/v1.1.1')
    expect(core.debug).toHaveBeenNthCalledWith(4, `Fetching release info from ${githubApiURL}/repos/${owner}/${repo}/releases/tags/${version}`)
    expect(core.debug).toHaveBeenNthCalledWith(5, `Found assets: [{"name":"piper","url":"${assetUrl}"}]`)
    expect(core.debug).toHaveBeenNthCalledWith(6, 'Found tag: v1.1.1')
    expect(core.debug).toHaveBeenNthCalledWith(7, `Found asset URL: ${assetUrl} and tag: ${version}`)
    expect(core.debug).toHaveBeenCalledTimes(8)
    expect(core.info).toHaveBeenNthCalledWith(1, expect.stringContaining(`Downloading '${assetUrl}' as '${process.cwd()}/${version.replace(/\./g, '_')}/piper'`))
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  test('Get dev Piper (branch mode)', async () => {
    const owner = 'SAP'
    const repository = 'jenkins-library'
    const branch = 'master'
    const sanitized = branch.replace(/[^0-9A-Za-z._-]/g, '-').replace(/-+/g, '-').slice(0, 40)

    jest.spyOn(toolCache, 'downloadTool').mockResolvedValue(`./${owner}-${repository}-${sanitized}/source-code.zip`)
    jest.spyOn(toolCache, 'extractZip').mockImplementation(async (_file: string, dest?: string) => {
      const target = dest ?? `./${owner}-${repository}-${sanitized}`
      const repoDir = `${target}/${repository}-${sanitized}`
      fs.mkdirSync(repoDir, { recursive: true })
      fs.writeFileSync(`${repoDir}/go.mod`, 'module github.com/SAP/jenkins-library')
      return target
    })
    jest.spyOn(process, 'chdir').mockImplementation(jest.fn())
    // Mock readdirSync using the single-arg overload that returns string[]
    jest.spyOn(fs, 'readdirSync').mockReturnValue([`${repository}-${sanitized}`] as any)

    expect(
      await buildPiperFromBranch(`devel:${owner}:${repository}:${branch}`)
    ).toBe(`${process.cwd()}/${owner}-${repository}-${sanitized}/piper`)
  })
})

describe('parseVersion', () => {
  it('should parse a valid version string', () => {
    const version = 'devel:GH_OWNER:REPOSITORY:feature/awesome'
    const { owner, repository, branch } = parseDevVersion(version)
    expect(owner).toBe('GH_OWNER')
    expect(repository).toBe('REPOSITORY')
    expect(branch).toBe('feature/awesome')
  })
  it('should throw an error for an invalid version string', () => {
    const version = 'invalid:version:string'
    expect(() => parseDevVersion(version)).toThrow('broken version')
  })
})

describe('getVersionName branch normalization', () => {
  test('simple branch stays same (<=40 chars)', () => {
    expect(getVersionName('main')).toBe('main')
  })

  test('trims surrounding whitespace', () => {
    expect(getVersionName('  feature-x  ')).toBe('feature-x')
  })

  test('replaces path separators "/" and "\\" with "-"', () => {
    expect(getVersionName('feat/JIRA\\123/sub')).toBe('feat-JIRA-123-sub')
  })

  test('replaces internal whitespace blocks with single "-"', () => {
    expect(getVersionName('feat multiple   spaces here')).toBe('feat-multiple-spaces-here')
  })

  test('fallback to branch-build when sanitized empty', () => {
    expect(getVersionName('   ')).toBe('branch-build')
  })

  test('fallback when result only hyphens', () => {
    expect(getVersionName('//// \\\\ ///')).toBe('branch-build')
  })

  test('truncates to 40 characters', () => {
    const long = 'feature/' + 'a'.repeat(100)
    const result = getVersionName(long)
    expect(result.length).toBe(40)
    // Starts with 'feature-' because of first replacement
    expect(result.startsWith('feature-')).toBe(true)
  })

  test('mixed separators and spaces produce collapsed dashes', () => {
    expect(getVersionName('a/b c\\d e/f')).toBe('a-b-c-d-e-f')
  })

  test('does not alter allowed characters other than trimming', () => {
    const branch = 'release-1.2.3_beta'
    expect(getVersionName(branch)).toBe(branch)
  })
})
