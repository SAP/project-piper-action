import { debug, getInput, setFailed, type InputOptions } from '@actions/core'
import {
  GITHUB_COM_API_URL,
  GITHUB_COM_SERVER_URL,
  PIPER_OWNER,
  PIPER_REPOSITORY,
  buildPiperFromSource,
  downloadPiperBinary, buildPiperInnerSource
} from './github'
import { chmodSync } from 'fs'
import { executePiper } from './execute'
import { type ActionConfiguration, getDefaultConfig, readContextConfig, createCheckIfStepActiveMaps } from './config'
import { loadPipelineEnv, exportPipelineEnv } from './pipelineEnv'
import { cleanupContainers, runContainers } from './docker'
import { isEnterpriseStep, onGitHubEnterprise } from './enterprise'

// Global runtime variables that is accessible within a single action execution
export const internalActionVariables = {
  piperBinPath: '',
  dockerContainerID: '',
  sidecarNetworkID: '',
  sidecarContainerID: ''
}

export async function run (): Promise<void> {
  try {
    const actionCfg = await getActionConfig({ required: false })
    await preparePiperBinary(actionCfg)

    await loadPipelineEnv()
    await executePiper('version')
    if (onGitHubEnterprise() && actionCfg.stepName !== 'getDefaults') {
      await getDefaultConfig(
        actionCfg.gitHubEnterpriseServer,
        actionCfg.gitHubEnterpriseApi,
        actionCfg.sapPiperVersion,
        actionCfg.gitHubEnterpriseToken,
        actionCfg.sapPiperOwner,
        actionCfg.sapPiperRepo,
        actionCfg.customDefaultsPaths
      )
      if (actionCfg.createCheckIfStepActiveMaps) {
        await createCheckIfStepActiveMaps(actionCfg)
      }
    }
    if (actionCfg.stepName !== '') {
      const flags = actionCfg.flags.split(' ')
      const contextConfig = await readContextConfig(actionCfg.stepName, flags)
      await runContainers(actionCfg, contextConfig)
      await executePiper(actionCfg.stepName, flags)
    }
    await exportPipelineEnv(actionCfg.exportPipelineEnvironment)
  } catch (error: unknown) {
    setFailed((() => {
      if (error instanceof Error) {
        return error.message
      }
      return String(error)
    })())
  } finally {
    await cleanupContainers()
  }
}

async function preparePiperBinary (actionCfg: ActionConfiguration): Promise<void> {
  const piperPath = await preparePiperPath(actionCfg)

  if (piperPath === undefined || piperPath === '') {
    throw new Error('Piper binary path is empty. Please check your action inputs.')
  }

  internalActionVariables.piperBinPath = piperPath
  debug('obtained piper binary at '.concat(piperPath))
  chmodSync(piperPath, 0o775)
}

async function preparePiperPath (actionCfg: ActionConfiguration): Promise<string> {
  if (isEnterpriseStep(actionCfg.stepName)) {
    // devel:ContinuousDelivery:piper-library:ff8df33b8ab17c19e9f4c48472828ed809d4496a
    if (actionCfg.sapPiperVersion.startsWith('devel:') && actionCfg.stepName !== '') {
      return await buildPiperInnerSource(actionCfg.piperVersion)
    }
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }
  // devel:SAP:jenkins-library:ff8df33b8ab17c19e9f4c48472828ed809d4496a
  if (actionCfg.piperVersion.startsWith('devel:') && actionCfg.stepName !== '') {
    return await buildPiperFromSource(actionCfg.piperVersion)
  }
  return await downloadPiperBinary(actionCfg.stepName, actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
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

  let stepNameValue = getValue('step-name')
  // TODO: remove command input
  if (stepNameValue === undefined || stepNameValue === '') {
    stepNameValue = getValue('command')
  }

  return {
    stepName: stepNameValue,
    flags: getValue('flags'),
    piperVersion: getValue('piper-version'),
    piperOwner: getValue('piper-owner', PIPER_OWNER),
    piperRepo: getValue('piper-repository', PIPER_REPOSITORY),
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
    dockerEnvVars: getValue('docker-env-vars'),
    sidecarImage: getValue('sidecar-image'),
    sidecarOptions: getValue('sidecar-options'),
    sidecarEnvVars: getValue('sidecar-env-vars'),
    retrieveDefaultConfig: getValue('retrieve-default-config') === 'true',
    customDefaultsPaths: getValue('custom-defaults-paths'),
    customStageConditionsPath: getValue('custom-stage-conditions-path'),
    createCheckIfStepActiveMaps: getValue('create-check-if-step-active-maps') === 'true',
    exportPipelineEnvironment: getValue('export-pipeline-environment') === 'true'
  }
}
