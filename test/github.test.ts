import fs from 'fs'

import * as toolCache from '@actions/tool-cache'
import * as octokit from '@octokit/core'

import { downloadPiperBinary, buildPiperFromSource, downloadFileFromGitHub } from '../src/github'

jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('@octokit/core')
jest.mock('node-fetch')

describe('GitHub package tests', () => {
  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })
  // TODO fetch mockery issue
  test.skip('Get latest o-s Piper without authorization', async () => {
    const piper = './v1_255_0/piper'
    jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve(piper))
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        url: 'https://github.com/SAP/jenkins-library/releases/tag/v1.255.0',
        status: 200
      })))
    expect(
      await downloadPiperBinary('help', 'latest', 'https://github.acme.com/api/v3', 'someToken', 'SAP', 'jenkins-library')
    ).toBe(piper)
  })
  test('Get master SAP Piper', async () => {
    const piper = `${process.cwd()}/1_255_0/sap-piper_master`
    jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve(piper))
    jest.spyOn(octokit, 'Octokit').mockImplementationOnce(() => {
      return {
        request: async () => {
          return await Promise.resolve(
            {
              data: {
                tag_name: '1.255.0',
                assets: [
                  {
                    name: 'sap-piper_master',
                    url: '',
                    browser_download_url: ''
                  }
                ]
              },
              status: 200
            }
          )
        }
      } as unknown as octokit.Octokit
    })
    expect(
      await downloadPiperBinary('sapAnything', 'master', 'https://github.acme.com/api/v3', 'blah-blah', 'SAP', 'jenkins-library')
    ).toBe(piper)
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
  test('Download file from GitHub', async () => {
    jest.spyOn(octokit, 'Octokit').mockImplementationOnce(() => {
      return {
        request: async (request: string) => {
          return await Promise.resolve(
            {
              url: request.split(' ')[1],
              type: 'file',
              content: 'testString',
              status: 200
            }
          )
        }
      } as unknown as octokit.Octokit
    })
    const testURL = 'https://github.acme.com/api/v3/repos/SAP/jenkins-library/contents/resources/piper-stage-config.yml'
    const testToken = 'testToken'

    const response = await downloadFileFromGitHub(testURL, testToken)

    expect(response.status).toBe(200)
    expect(response.url).toBe('/repos/SAP/jenkins-library/contents/resources/piper-stage-config.yml')
    expect(octokit.Octokit).toHaveBeenCalledWith({ auth: testToken, baseUrl: 'https://github.acme.com/api/v3' })
  })
})
