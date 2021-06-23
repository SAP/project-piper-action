const mockDownload = jest.fn()
const mockGithubEndpoint = jest.fn().mockReturnValue({ download: mockDownload })
const mockGithubDownloadConstructor = jest.fn().mockImplementation(() => ({ githubEndpoint: mockGithubEndpoint }))
jest.mock('@actions/exec')
jest.mock('@sap/project-piper-action-utils', () => {
  return {
    GithubDownloaderBuilder: mockGithubDownloadConstructor,
    DirectoryRestore: jest.fn().mockImplementation(() => ({ githubEndpoint: mockGithubEndpoint }))
  }
})

const core = require('@actions/core')
const exec = require('@actions/exec')
const fs = require('fs')

const run = require('../src/piper.js')

describe('Piper', () => {
  let inputs

  beforeEach(() => {
    inputs = {
      command: 'version',
      flags: '--noTelemetry',
      'piper-version': 'latest'
    }

    fs.chmodSync = jest.fn()
    jest.spyOn(core, 'setFailed')
    jest.spyOn(core, 'getInput').mockImplementation((name, options) => {
      const val = inputs[name]
      if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`)
      }
      return val.trim()
    })
  })
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('download of specific version', async () => {
    const piperVersion = 'v1.10.0'
    inputs['piper-version'] = piperVersion

    await run()
    expect(mockGithubDownloadConstructor).toHaveBeenCalledWith('sap', 'jenkins-library', 'piper', piperVersion)
    expect(mockGithubEndpoint).toHaveBeenCalled()
    expect(mockDownload).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(exec.exec).toHaveBeenNthCalledWith(1, 'piper version')
    expect(exec.exec).toHaveBeenNthCalledWith(2, 'piper version --noTelemetry')
  })

  test('download of master version', async () => {
    const piperVersion = 'master'
    inputs['piper-version'] = piperVersion

    await run()

    expect(mockGithubDownloadConstructor).toHaveBeenCalledWith('sap', 'jenkins-library', 'piper', piperVersion)
    expect(mockGithubEndpoint).toHaveBeenCalled()
    expect(mockDownload).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(exec.exec).toHaveBeenNthCalledWith(1, 'piper version')
    expect(exec.exec).toHaveBeenNthCalledWith(2, 'piper version --noTelemetry')
  })

  test('download failed', async () => {
    const errorMessage = 'Some Error'

    mockDownload.mockImplementation(() => { throw new Error(errorMessage) })
    await run()

    expect(core.setFailed).toHaveBeenCalledWith(errorMessage)
  })
})
