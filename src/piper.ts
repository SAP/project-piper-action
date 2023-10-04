import { debug, exportVariable, getInput, setFailed, type InputOptions } from '@actions/core'
import { GITHUB_COM_API_URL, GITHUB_COM_SERVER_URL, buildPiperFromSource, downloadPiperBinary } from './github'
import { chmodSync } from 'fs'
import { executePiper } from './execute'
import { getDefaultConfig, readContextConfig, createCheckIfStepActiveMaps } from './config'
import { loadPipelineEnv, exportPipelineEnv } from './pipelineEnv'
import { startContainer } from './docker'
import { isEnterpriseStep, onGitHubEnterprise } from './enterprise'

export async function run (): Promise<void> {
  try {
    const actCfg = await getActionConfig({ required: false })
    let piperPath

    if (isEnterpriseStep(actCfg.stepName)) {
      piperPath = await downloadPiperBinary(actCfg.stepName, actCfg.sapPiperVersion, actCfg.gitHubEnterpriseApi, actCfg.gitHubEnterpriseToken, actCfg.sapPiperOwner, actCfg.sapPiperRepo)
    } else {
      if (/^devel:/.test(actCfg.piperVersion)) {
        piperPath = await buildPiperFromSource(actCfg.piperVersion)
      } else {
        piperPath = await downloadPiperBinary(actCfg.stepName, actCfg.piperVersion, actCfg.gitHubApi, actCfg.gitHubToken, actCfg.piperOwner, actCfg.piperRepo)
      }
    }
    chmodSync(piperPath, 0o775)
    exportVariable('piperPath', piperPath)

    await loadPipelineEnv()
    await executePiper('version')
    if (onGitHubEnterprise()) {
      await getDefaultConfig(actCfg.gitHubEnterpriseServer, actCfg.gitHubEnterpriseToken, actCfg.sapPiperOwner, actCfg.sapPiperRepo, actCfg.customDefaultsPaths)
    }
    if (actCfg.createCheckIfStepActiveMaps) {
      await createCheckIfStepActiveMaps(actCfg.gitHubEnterpriseToken, actCfg.sapPiperOwner, actCfg.sapPiperRepo)
    }
    if (actCfg.stepName !== '') {
      const contextConfig = await readContextConfig(actCfg.stepName)
      const containerID = await startContainer(actCfg.dockerImage, actCfg.dockerOptions, contextConfig)
      await executePiper(actCfg.stepName, actCfg.flags.split(' '), containerID)
    }
    await exportPipelineEnv(actCfg.exportPipelineEnvironment)
  } catch (error: unknown) {
    setFailed((() => {
      if (error instanceof Error) {
        return error.message
      }
      return String(error)
    })())
  }
}

export interface ActionConfiguration {
  stepName: string
  flags: string
  piperVersion: string
  piperOwner: string
  piperRepo: string
  sapPiperVersion: string
  sapPiperOwner: string
  sapPiperRepo: string
  gitHubServer: string
  gitHubApi: string
  gitHubToken: string
  gitHubEnterpriseServer: string
  gitHubEnterpriseApi: string
  gitHubEnterpriseToken: string
  dockerImage: string
  dockerOptions: string
  retrieveDefaultConfig: boolean
  customDefaultsPaths: string
  createCheckIfStepActiveMaps: boolean
  exportPipelineEnvironment: boolean
}

async function getActionConfig (options: InputOptions): Promise<ActionConfiguration> {
  const getValue = (param: string, defaultValue?: string): string => {
    let value: string = getInput(param, options)
    if (value === '') {
      // EnVs should be provided like this
      // PIPER_ACTION_DOWNLOAD_URL
      value = process.env[`PIPER_ACTION_${param.toUpperCase().replace(/-/g, '_')}`] ?? ''
      if (value === '') {
        if (defaultValue !== undefined) {
          return defaultValue
        }
        return ''
      }
    }
    debug(`${param}: ${value}`)
    return value
  }
  let enterpriseHost: string = ''
  let enterpriseApi: string = ''
  if (onGitHubEnterprise()) {
    if (process.env.GITHUB_SERVER_URL !== undefined) {
      enterpriseHost = process.env.GITHUB_SERVER_URL
    }
    if (process.env.GITHUB_API_URL !== undefined) {
      enterpriseApi = process.env.GITHUB_API_URL
    }
  }

  return {
    stepName: getValue('step-name'),
    flags: getValue('flags'),
    piperVersion: getValue('piper-version'),
    piperOwner: getValue('piper-owner', 'SAP'),
    piperRepo: getValue('piper-repository', 'jenkins-library'),
    sapPiperVersion: getValue('sap-piper-version'),
    sapPiperOwner: getValue('sap-piper-owner'),
    sapPiperRepo: getValue('sap-piper-repository'),
    gitHubToken: getValue('github-token'),
    gitHubServer: GITHUB_COM_SERVER_URL,
    gitHubApi: GITHUB_COM_API_URL,
    gitHubEnterpriseServer: enterpriseHost,
    gitHubEnterpriseApi: enterpriseApi,
    gitHubEnterpriseToken: getValue('github-enterprise-token'),
    dockerImage: getValue('docker-image'),
    dockerOptions: getValue('docker-options'),
    retrieveDefaultConfig: getValue('retrieve-default-config') === 'true',
    customDefaultsPaths: getValue('custom-defaults-paths'),
    createCheckIfStepActiveMaps: getValue('create-check-if-step-active-maps') === 'true',
    exportPipelineEnvironment: getValue('export-pipeline-environment') === 'true'
  }
}
