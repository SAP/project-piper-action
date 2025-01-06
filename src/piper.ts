import { debug, getInput, setFailed, type InputOptions } from '@actions/core'
import {
  GITHUB_COM_API_URL,
  GITHUB_COM_SERVER_URL,
  PIPER_OWNER,
  PIPER_REPOSITORY,
  downloadPiperBinary
} from './github'
import { buildPiperFromSource } from './build'
import { chmodSync } from 'fs'
import { executePiper } from './execute'
import { getDefaultConfig, readContextConfig, createCheckIfStepActiveMaps } from './config'
import { loadPipelineEnv, exportPipelineEnv } from './pipelineEnv'
import { cleanupContainers, runContainers } from './docker'
import { isEnterpriseStep, onGitHubEnterprise } from './enterprise'
import { type ActionConfiguration } from './types'

// Global runtime variables that is accessible within a single action execution
export const internalActionVariables = {
  piperBinPath: '',
  dockerContainerID: '',
  sidecarNetworkID: '',
  sidecarContainerID: ''
}

export async function run (): Promise<void> {
  // TODO: Where to put this check?
  // try {
  //   const roleId = process.env.PIPER_VAULTAPPROLEID
  //   const secretId = process.env.PIPER_VAULTAPPSECRETID
  //
  //   if (roleId === undefined || roleId === '') {
  //     setFailed('PIPER_VAULTAPPROLEID is not set. Please provide the Role ID to authenticate with Vault.')
  //   }
  //   if (secretId === undefined || secretId === '') {
  //     setFailed('PIPER_VAULTAPPSECRETID is not set. Please provide the Secret ID to authenticate with Vault.')
  //   }
  // } catch (error: unknown) {
  //   setFailed((() => {
  //     if (error instanceof Error) {
  //       return error.message
  //     }
  //     return String(error)
  //   })())
  // }

  try {
    const actionCfg: ActionConfiguration = await getActionConfig({ required: false })
    const piperPath = await preparePiperBinary(actionCfg)

    if (piperPath === undefined || piperPath === '') {
      throw new Error('Piper binary path is empty. Please check your action inputs.')
    }

    internalActionVariables.piperBinPath = piperPath
    debug('obtained piper binary at '.concat(piperPath))
    chmodSync(piperPath, 0o775)

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

async function preparePiperBinary (actionCfg: ActionConfiguration): Promise<string> {
  if (actionCfg.piperVersion.startsWith('devel:')) {
    if (isEnterpriseStep(actionCfg.stepName)) {
    // TODO: build piper binary from source
      throw new Error('Enterprise steps cannot be built from source')
    }
    // build piper binary from OS source
    return await buildPiperFromSource(actionCfg.piperVersion)
  }
  // download piper binary
  if (isEnterpriseStep(actionCfg.stepName)) {
    return await downloadPiperBinary(actionCfg.stepName, actionCfg.sapPiperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.sapPiperOwner, actionCfg.sapPiperRepo)
  }
  return await downloadPiperBinary(actionCfg.stepName, actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}

function getEnvValue (param: string, defaultValue: string = ''): string {
  // EnVs should be provided like this:
  // PIPER_ACTION_DOWNLOAD_URL
  return process.env[param] ?? defaultValue
}

async function getActionConfig (options: InputOptions): Promise<ActionConfiguration> {
  const getValue = (param: string, defaultValue: string = ''): string => {
    let value: string = getInput(param, options)
    if (value === '') {
      value = getEnvValue(`PIPER_ACTION_${param.toUpperCase().replace(/-/g, '_')}`, defaultValue)
    }

    if (value !== '') debug(`${param}: ${value}`)
    return value
  }

  const enterpriseHost: string = onGitHubEnterprise() ? process.env.GITHUB_SERVER_URL ?? '' : ''
  const enterpriseApi: string = onGitHubEnterprise() ? process.env.GITHUB_API_URL ?? '' : ''

  let stepNameValue = getValue('step-name')
  // TODO: remove command input
  if (stepNameValue === '') stepNameValue = getValue('command')

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
