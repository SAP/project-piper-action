import fs from 'fs'

import * as core from '@actions/core'

import * as piper from '../src/piper'
import * as config from '../src/config'
import * as execute from '../src/execute'
import * as github from '../src/github'
import * as download from '../src/download'
import * as docker from '../src/docker'
import * as pipelineEnv from '../src/pipelineEnv'
import { GITHUB_COM_API_URL } from '../src/github'
import { internalActionVariables } from '../src/piper'

describe('Piper', () => {
  let inputs: any

  beforeEach(() => {
    inputs = {
      'step-name': '',
      flags: '',
      'piper-version': '',
      'piper-owner': 'SAP',
      'piper-repository': 'jenkins-library',
      'sap-piper-version': '',
      'sap-piper-owner': '',
      'sap-piper-repository': '',
      'github-token': '',
      'github-enterprise-token': '',
      'wdf-github-enterprise-token': '',
      'docker-image': '',
      'docker-options': '',
      'docker-env-vars': '',
      'sidecar-image': '',
      'sidecar-options': '',
      'sidecar-env-vars': '',
      'retrieve-default-config': 'false',
      'custom-defaults-paths': '',
      'custom-stage-conditions-path': '',
      'create-check-if-step-active-maps': '',
      'export-pipeline-environment': ''
    }

    fs.chmodSync = jest.fn()
    jest.spyOn(download, 'downloadPiperBinary').mockReturnValue(Promise.resolve('./piper'))
    jest.spyOn(github, 'buildPiperFromSource').mockReturnValue(Promise.resolve('./piper'))
    jest.spyOn(execute, 'executePiper').mockImplementation()
    jest.spyOn(config, 'getDefaultConfig').mockImplementation()
    jest.spyOn(config, 'readContextConfig').mockImplementation()
    jest.spyOn(config, 'createCheckIfStepActiveMaps').mockImplementation()
    jest.spyOn(docker, 'runContainers').mockImplementation()
    jest.spyOn(docker, 'cleanupContainers').mockImplementation()
    jest.spyOn(pipelineEnv, 'loadPipelineEnv').mockImplementation()
    jest.spyOn(pipelineEnv, 'exportPipelineEnv').mockImplementation()
    jest.spyOn(core, 'setFailed').mockImplementation()
    jest.spyOn(core, 'getInput').mockImplementation((name: string, options?: core.InputOptions) => {
      const val = inputs[name]
      if (options !== undefined) {
        // if (options.required && val == undefined) {
        if ((options.required ?? false) && val === undefined) {
          throw new Error(`Input required and not supplied: ${name}`)
        }
      }

      return val.trim()
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    internalActionVariables.piperBinPath = ''
    internalActionVariables.sidecarNetworkID = ''
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.sidecarContainerID = ''
  })

  test('isEnterpriseStep', async () => {
    inputs['step-name'] = 'sapGenerateEnvironmentInfo'
    inputs['sap-piper-version'] = '1.2.3'
    inputs['github-enterprise-token'] = 'testToolsToken'
    inputs['wdf-github-enterprise-token'] = 'testWDFToken'
    inputs['sap-piper-owner'] = 'project-piper'
    inputs['sap-piper-repository'] = 'testRepo'
    inputs['create-check-if-step-active-maps'] = 'true'
    process.env.GITHUB_SERVER_URL = 'https://githubenterprise.test.com/'
    process.env.GITHUB_API_URL = 'https://api.githubenterprise.test.com/'

    await piper.run()

    expect(download.downloadPiperBinary).toHaveBeenCalledWith(
      inputs['step-name'],
      '',
      inputs['sap-piper-version'],
      'https://api.githubenterprise.test.com/',
      inputs['github-enterprise-token'],
      // inputs['wdf-github-enterprise-token'],
      inputs['sap-piper-owner'],
      inputs['sap-piper-repository']
    )
    expect(config.createCheckIfStepActiveMaps).toHaveBeenCalled()
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })

  test('development version build from source', async () => {
    inputs['step-name'] = 'getConfig'
    inputs['piper-version'] = 'devel:testOwner:testRepo:1.1.1'

    await piper.run()

    expect(github.buildPiperFromSource).toHaveBeenCalledWith(inputs['piper-version'])
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })

  test('open-source command', async () => {
    inputs['step-name'] = 'getConfig'
    inputs['piper-version'] = '1.2.2'
    inputs['github-token'] = 'testGithubToken'
    inputs['piper-owner'] = 'SAP'
    inputs['piper-repository'] = 'jenkins-library'

    await piper.run()

    expect(download.downloadPiperBinary).toHaveBeenCalledWith(
      inputs['step-name'],
      '',
      inputs['piper-version'],
      GITHUB_COM_API_URL,
      inputs['github-token'],
      inputs['piper-owner'],
      inputs['piper-repository']
    )
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })

  test('getConfig command to get enterprise step config', async () => {
    inputs['step-name'] = 'getConfig'
    inputs.flags = '--stepName sapGenerateEnvironmentInfo'
    inputs['sap-piper-version'] = '1.2.3'
    inputs['github-enterprise-token'] = 'testToolsToken'
    inputs['wdf-github-enterprise-token'] = 'testWDFToken'
    inputs['sap-piper-owner'] = 'project-piper'
    inputs['sap-piper-repository'] = 'testRepo'
    inputs['create-check-if-step-active-maps'] = 'true'
    process.env.GITHUB_SERVER_URL = 'https://githubenterprise.test.com/'
    process.env.GITHUB_API_URL = 'https://api.githubenterprise.test.com/'

    await piper.run()

    expect(download.downloadPiperBinary).toHaveBeenCalledWith(
      inputs['step-name'],
      inputs.flags,
      inputs['sap-piper-version'],
      'https://api.githubenterprise.test.com/',
      inputs['github-enterprise-token'],
      inputs['sap-piper-owner'],
      inputs['sap-piper-repository']
    )
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })

  test('failed obtaining piper binary', async () => {
    inputs['step-name'] = 'getConfig'
    inputs['piper-version'] = '1.2.2'
    inputs['github-token'] = 'testGithubToken'
    inputs['piper-owner'] = 'SAP'
    inputs['piper-repository'] = 'jenkins-library'
    jest.spyOn(download, 'downloadPiperBinary').mockReturnValue(Promise.resolve(''))

    await piper.run()
    expect(core.setFailed).toHaveBeenCalledWith('Piper binary path is empty. Please check your action inputs.')
    expect(internalActionVariables.piperBinPath).toEqual('')
    expect(execute.executePiper).not.toHaveBeenCalled()
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })

  test('step execution failure with non-zero exit code', async () => {
    inputs['step-name'] = 'mavenBuild'
    inputs['piper-version'] = '1.2.2'
    inputs['github-token'] = 'testGithubToken'
    inputs['piper-owner'] = 'SAP'
    inputs['piper-repository'] = 'jenkins-library'

    jest.spyOn(execute, 'executePiper').mockResolvedValue({
      stdout: 'error output',
      stderr: 'step failed',
      exitCode: 1
    })

    await piper.run()

    expect(core.setFailed).toHaveBeenCalledWith('Step mavenBuild failed with exit code 1')
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })
})
