import fs from 'fs'

import * as toolCache from '@actions/tool-cache'
import * as octokit from '@octokit/core'
import * as core from '@actions/core'

import { buildPiperFromSource } from '../src/github'
import { downloadPiperBinary } from '../src/download'
import { parseDevVersion } from '../src/build'

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
    jest.spyOn(toolCache, 'find').mockReturnValue('') // No cache hit
    jest.spyOn(toolCache, 'downloadTool').mockResolvedValue('/tmp/downloaded-piper')
    jest.spyOn(toolCache, 'cacheFile').mockResolvedValue('/tool-cache/piper/v1.1.1')
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
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloading'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Caching binary as'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Binary cached at'))
  })

  test('downloadPiperBinary - SAP step latest', async () => {
    const assetUrl = `${githubApiURL}/release/assets/123456`
    jest.spyOn(toolCache, 'find').mockReturnValue('') // No cache hit
    jest.spyOn(toolCache, 'downloadTool').mockResolvedValue('/tmp/downloaded-sap-piper')
    jest.spyOn(toolCache, 'cacheFile').mockResolvedValue('/tool-cache/sap-piper/v1.1.1')
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
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloading'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Caching binary as'))
  })

  test('downloadPiperBinary - OS step, exact version', async () => {
    const assetUrl = `${githubApiURL}/release/assets/123456`
    jest.spyOn(toolCache, 'find').mockReturnValue('') // No cache hit
    jest.spyOn(toolCache, 'downloadTool').mockResolvedValue('/tmp/downloaded-piper')
    jest.spyOn(toolCache, 'cacheFile').mockResolvedValue('/tool-cache/piper/v1.1.1')
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
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloading'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Caching binary as'))
  })

  test('Get dev Piper', async () => {
    const owner = 'SAP'
    const repository = 'jenkins-library'
    const commitISH = '2866ef5592e13ac3afb693a7a5596eda37f085aa'
    const shortCommitSHA = commitISH.slice(0, 7)
    jest.spyOn(toolCache, 'find').mockReturnValue('') // No cache hit
    jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve(`./${owner}-${repository}-${shortCommitSHA}/source-code.zip`))
    jest.spyOn(toolCache, 'extractZip').mockReturnValue(Promise.resolve(`./${owner}-${repository}-${shortCommitSHA}`))
    jest.spyOn(toolCache, 'cacheFile').mockResolvedValue(`/tool-cache/${owner}-${repository}-piper/${shortCommitSHA}`)
    jest.spyOn(process, 'chdir').mockImplementation(jest.fn())
    jest.spyOn(process, 'cwd').mockImplementation(jest.fn())
    jest.spyOn(fs, 'readdirSync').mockReturnValue([])
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn())
    jest.spyOn([], 'find').mockImplementation(jest.fn())
    expect(
      await buildPiperFromSource(`devel:${owner}:${repository}:${commitISH}`)
    ).toBe(`/tool-cache/${owner}-${repository}-piper/${shortCommitSHA}/piper`)
  })

  test('downloadPiperBinary - cache hit, reuses cached binary', async () => {
    const cachedPath = '/tool-cache/someOwner-SomeRepo-piper/v1.1.1'
    jest.spyOn(toolCache, 'find').mockReturnValue(cachedPath) // Cache hit
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        status: 200,
        url: 'https://github.com/SAP/jenkins-library/releases/tag/v1.1.1'
      } as unknown as Response
    })

    const result = await downloadPiperBinary(osStep, '', 'latest', githubApiURL, '', owner, repo)
    expect(result).toBe(`${cachedPath}/piper`)
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Using cached binary from tool cache'))
    // Should not download or cache again
    expect(toolCache.downloadTool).not.toHaveBeenCalled()
    expect(toolCache.cacheFile).not.toHaveBeenCalled()
  })

  test('buildPiperFromSource - cache hit, reuses cached binary', async () => {
    const owner = 'SAP'
    const repository = 'jenkins-library'
    const commitISH = '2866ef5592e13ac3afb693a7a5596eda37f085aa'
    const shortCommitSHA = commitISH.slice(0, 7)
    const cachedPath = `/tool-cache/${owner}-${repository}-piper/${shortCommitSHA}`

    jest.spyOn(toolCache, 'find').mockReturnValue(cachedPath) // Cache hit

    const result = await buildPiperFromSource(`devel:${owner}:${repository}:${commitISH}`)
    expect(result).toBe(`${cachedPath}/piper`)
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Using cached binary from tool cache'))
    // Should not build or download
    expect(toolCache.downloadTool).not.toHaveBeenCalled()
    expect(toolCache.extractZip).not.toHaveBeenCalled()
  })
})

describe('parseVersion', () => {
  it('should parse a valid version string', () => {
    const version = 'devel:GH_OWNER:REPOSITORY:COMMITISH'
    const { owner, repository, commitISH } = parseDevVersion(version)
    expect(owner).toBe('GH_OWNER')
    expect(repository).toBe('REPOSITORY')
    expect(commitISH).toBe('COMMITISH')
  })

  it('should throw an error for an invalid version string', () => {
    const version = 'invalid:version:string'
    expect(() => parseDevVersion(version)).toThrow('broken version')
  })
})
