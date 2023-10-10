import fs from 'fs'

import * as core from '@actions/core'

import * as piper from '../src/piper'
import * as config from '../src/config'
import * as execute from '../src/execute'
import * as github from '../src/github'
import * as docker from '../src/docker'
import * as pipelineEnv from '../src/pipelineEnv'
import {GITHUB_COM_API_URL} from "../src/github";

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
      'docker-image': '',
      'docker-options': '',
      'docker-env-vars': '',
      'sidecar-image': '',
      'sidecar-options': '',
      'sidecar-env-vars': '',
      'retrieve-default-config': 'false',
      'custom-defaults-paths': '',
      'create-check-if-step-active-maps': '',
      'export-pipeline-environment': ''
    }

    fs.chmodSync = jest.fn()
    jest.spyOn(github, 'downloadPiperBinary').mockReturnValue('./piper' as unknown as Promise<string>)
    jest.spyOn(github, 'buildPiperFromSource').mockReturnValue('./piper' as unknown as Promise<string>)
    jest.spyOn(execute, 'executePiper').mockImplementation()
    jest.spyOn(config, 'getDefaultConfig').mockImplementation()
    jest.spyOn(config, 'readContextConfig').mockImplementation()
    jest.spyOn(config, 'createCheckIfStepActiveMaps').mockImplementation()
    jest.spyOn(docker, 'runContainers').mockImplementation()
    jest.spyOn(docker, 'cleanupContainers').mockImplementation()
    jest.spyOn(pipelineEnv, 'loadPipelineEnv').mockImplementation()
    jest.spyOn(pipelineEnv, 'exportPipelineEnv').mockImplementation()
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

  test('isEnterpriseStep', async () => {
    inputs['step-name'] = 'sapGenerateEnvironmentInfo'
    inputs['sap-piper-version'] = '1.2.3'
    inputs['github-enterprise-token'] = 'testToolsToken'
    inputs['sap-piper-owner'] = 'project-piper'
    inputs['sap-piper-repository'] = 'testRepo'
    inputs['create-check-if-step-active-maps'] = 'true'
    process.env.GITHUB_SERVER_URL = "https://githubenterprise.test.com/"
    process.env.GITHUB_API_URL = "https://api.githubenterprise.test.com/"

    await piper.run()

    expect(github.downloadPiperBinary).toHaveBeenCalledWith(
        inputs['step-name'],
        inputs['sap-piper-version'],
        "https://api.githubenterprise.test.com/",
        inputs['github-enterprise-token'],
        inputs['sap-piper-owner'],
        inputs['sap-piper-repository']
    )
    expect(config.createCheckIfStepActiveMaps).toHaveBeenCalledWith(
        inputs['github-enterprise-token'], inputs['sap-piper-owner'], inputs['sap-piper-repository'])
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

    expect(github.downloadPiperBinary).toHaveBeenCalledWith(
        inputs['step-name'],
        inputs['piper-version'],
        GITHUB_COM_API_URL,
        inputs['github-token'],
        inputs['piper-owner'],
        inputs['piper-repository']
    )
    expect(docker.cleanupContainers).toHaveBeenCalled()
  })
})
