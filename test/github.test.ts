import fs from 'fs'

import * as octokit from '@octokit/core'
import * as core from '@actions/core'

import { downloadSapPiper, downloadOSPiper } from '../src/download'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('@octokit/core')
jest.mock('node-fetch')

describe('GitHub package tests', () => {
  const version = 'v1.1.1'
  const githubApiURL = 'https://github.acme.com/api/v3'
  const token = 'someToken'
  const owner = 'someOwner'
  const repo = 'SomeRepo'
  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  test('downloadSapPiper - no token', async () => {
    try {
      await downloadSapPiper('latest', githubApiURL, '', owner, repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('Token is not provided for enterprise step'))
    }
  })

  test('downloadSapPiper - no owner', async () => {
    try {
      await downloadSapPiper('latest', githubApiURL, token, '', repo)
    } catch (e) {
      expect(e).toStrictEqual(Error('owner is not provided'))
    }
  })

  test('downloadSapPiper - no repo', async () => {
    try {
      await downloadSapPiper('latest', githubApiURL, token, owner, '')
    } catch (e) {
      expect(e).toStrictEqual(Error('repository is not provided'))
    }
  })

  test('downloadOSPiper - latest, no token', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        status: 200,
        url: 'https://github.com/SAP/jenkins-library/releases/tag/v1.1.1'
      } as unknown as Response
    })

    await downloadOSPiper('latest', githubApiURL, '', owner, repo)
    expect(core.debug).toHaveBeenNthCalledWith(1, 'version: latest')
    expect(core.debug).toHaveBeenNthCalledWith(2, 'Fetching binary from URL')
    expect(core.debug).toHaveBeenCalledTimes(4)
    expect(core.info).toHaveBeenCalledWith(`Downloading 'https://github.com/SAP/jenkins-library/releases/download/v1.1.1/piper' as '${process.cwd()}/${version.replace(/\./g, '_')}/piper'`)
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  test('downloadSapPiper - latest', async () => {
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

    await downloadSapPiper('latest', githubApiURL, token, owner, repo)
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

  test('downloadOSPiper - exact version with token', async () => {
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

    await downloadOSPiper(version, githubApiURL, token, owner, repo)
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
})
