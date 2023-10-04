import fs from 'fs'

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as artifact from '@actions/artifact'

import * as piper from '../src/piper'
import * as github from '../src/github'

jest.mock('@actions/exec')
jest.mock('../src/github')
jest.mock('@actions/artifact')

describe('Piper', () => {
  let inputs: any

  beforeEach(() => {
    inputs = {
      stepName: '',
      flags: '',
      'download-url': '',
      'piper-version': '',
      'sap-piper-version': '',
      'github-token': '',
      'github-enterprise-token': '',
      'docker-image': '',
      'docker-options': '',
      'retrieve-default-config': 'false',
      'custom-defaults-paths': ''
    }
    process.env.PIPER_ACTION_STEP_NAME = 'sapInternalStep'
    process.env.PIPER_ACTION_PIPER_VERSION = 'https://github.com/SAP/jenkins-library/releases/download/v1.255.0/piper'
    process.env.PIPER_ACTION_SAP_PIPER_VERSION = '1.191.0'
    process.env.PIPER_ACTION_GITHUB_ENTERPRISE_TOKEN = 'blahblahtoken'
    process.env.PIPER_ACTION_RETRIEVE_DEFAULT_CONFIG = 'false'
    fs.chmodSync = jest.fn()
    jest.spyOn(github, 'downloadPiperBinary').mockReturnValue(Promise.resolve('./piper'))
    jest.spyOn(core, 'setFailed')
    jest.spyOn(core, 'getInput').mockImplementation((name: string, options?: core.InputOptions) => {
      const val = inputs[name]
      if (options?.required !== undefined && val !== undefined) {
        throw new Error(`Input required and not supplied: ${name}`)
      }
      return val.trim()
    })
    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))
    jest.spyOn(artifact, 'create').mockReturnValue({
      uploadArtifact: async () => {
        return await Promise.resolve({})
      },
      downloadArtifact: async () => {
        return await Promise.resolve({})
      }
    } as unknown as artifact.ArtifactClient)
  })
  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  const expectedOptions = expect.objectContaining({ listeners: expect.anything() })

  test.skip('default', async () => {
    await piper.run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(github.downloadPiperBinary).toHaveBeenCalledWith('help', 'latest', '')
    expect(fs.chmodSync).toHaveBeenCalledWith('./piper', 0o775)
    expect(exec.exec).toHaveBeenCalledTimes(2)
    expect(exec.exec).toHaveBeenCalledWith('./piper', ['version'], expectedOptions)
    expect(exec.exec).toHaveBeenCalledWith('./piper', ['help', ...['--noTelemetry']], expectedOptions)
  })

  test.skip('download of specific version', async () => {
    inputs.version = 'v1.10.0'

    await piper.run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(github.downloadPiperBinary).toHaveBeenCalledWith('help', inputs.version, '')
  })

  test.skip('download of master version', async () => {
    inputs.version = 'master'

    await piper.run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(github.downloadPiperBinary).toHaveBeenCalledWith('help', 'master', '')
  })

  test.skip('download of version fallback', async () => {
    inputs.version = 'murks'

    await piper.run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(github.downloadPiperBinary).toHaveBeenCalledWith('help', 'murks', '')
  })
})
