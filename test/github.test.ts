import fs from 'fs'

import * as toolCache from '@actions/tool-cache'
import * as octokit from '@octokit/core'
import * as core from '@actions/core'

import { downloadPiperBinary, buildPiperFromSource } from '../src/github'

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
      await downloadPiperBinary(sapStep, 'latest', githubApiURL, '', owner, repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('Token is not provided for enterprise step'))
    }
  })

  test('downloadPiperBinary - no owner', async () => {
    try {
      await downloadPiperBinary(sapStep, 'latest', githubApiURL, token, '', repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('owner is not provided'))
    }
  })

  test('downloadPiperBinary - no repo', async () => {
    try {
      await downloadPiperBinary(sapStep, 'latest', githubApiURL, token, owner, '')
    } catch (e) {
      expect(e).toStrictEqual(Error('repository is not provided'))
    }
  })

  test('downloadPiperBinary - OS step latest, no token', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return await Promise.resolve({
        status: 200,
        url: 'https://github.com/SAP/jenkins-library/releases/tag/v1.1.1'
      } as unknown as Response)
    })

    await downloadPiperBinary(osStep, 'latest', githubApiURL, '', owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'Fetching binary from URL')
    expect(core.debug).toHaveBeenCalledTimes(1)
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

    await downloadPiperBinary(sapStep, 'latest', githubApiURL, token, owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'Fetching binary from GitHub API')
    expect(core.debug).toHaveBeenNthCalledWith(2, `Fetching release info from ${githubApiURL}/repos/${owner}/${repo}/releases/latest`)
    expect(core.debug).toHaveBeenNthCalledWith(5, `Found asset URL: ${assetUrl} and tag: ${version}`)
    expect(core.debug).toHaveBeenCalledTimes(5)
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

    await downloadPiperBinary(osStep, version, githubApiURL, token, owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'Fetching binary from GitHub API')
    expect(core.debug).toHaveBeenNthCalledWith(2, `Fetching release info from ${githubApiURL}/repos/${owner}/${repo}/releases/tags/${version}`)
    expect(core.debug).toHaveBeenNthCalledWith(5, `Found asset URL: ${assetUrl} and tag: ${version}`)
    expect(core.debug).toHaveBeenCalledTimes(5)
    expect(core.info).toHaveBeenNthCalledWith(1, expect.stringContaining(`Downloading '${assetUrl}' as '${process.cwd()}/${version.replace(/\./g, '_')}/piper'`))
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  test('Get dev Piper', async () => {
    const owner = 'SAP'
    const repository = 'jenkins-library'
    const commitISH = '2866ef5592e13ac3afb693a7a5596eda37f085aa'
    const shortCommitSHA = commitISH.slice(0, 7)
    jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve(`./${owner}-${repository}-${shortCommitSHA}/source-code.zip`))
    jest.spyOn(toolCache, 'extractZip').mockReturnValue(Promise.resolve(`./${owner}-${repository}-${shortCommitSHA}`))
    jest.spyOn(process, 'chdir').mockImplementation(jest.fn())
    jest.spyOn(process, 'cwd').mockImplementation(jest.fn())
    jest.spyOn(fs, 'readdirSync').mockReturnValue([])
    jest.spyOn([], 'find').mockImplementation(jest.fn())
    expect(
      await buildPiperFromSource(`devel:${owner}:${repository}:${commitISH}`)
    ).toBe(`${process.cwd()}/${owner}-${repository}-${shortCommitSHA}/piper`)
  })
})
