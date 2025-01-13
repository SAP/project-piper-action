import * as path from 'path'
import * as fs from 'fs'
import { debug, exportVariable, info } from '@actions/core'
import * as artifact from '@actions/artifact'
import { type UploadResponse } from '@actions/artifact'
import { executePiper } from './execute'
import { getHost } from './github'
import {
  ENTERPRISE_DEFAULTS_FILENAME,
  ENTERPRISE_STAGE_CONFIG_FILENAME,
  DEFAULT_CONFIG,
  STAGE_CONFIG,
  getEnterpriseConfigUrl
} from './enterprise'
import { internalActionVariables } from './piper'

export const CONFIG_DIR = '.pipeline'
export const ARTIFACT_NAME = 'Pipeline defaults'

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
  dockerEnvVars: string
  sidecarImage: string
  sidecarOptions: string
  sidecarEnvVars: string
  retrieveDefaultConfig: boolean
  customDefaultsPaths: string
  customStageConditionsPath: string
  createCheckIfStepActiveMaps: boolean
  exportPipelineEnvironment: boolean
}

export async function getDefaultConfig (server: string, apiURL: string, version: string, token: string, owner: string, repository: string, customDefaultsPaths: string): Promise<number> {
  if (fs.existsSync(path.join(CONFIG_DIR, ENTERPRISE_DEFAULTS_FILENAME))) {
    info('Defaults are present')
    debug(process.env.defaultsFlags !== undefined
      ? `Defaults flags: ${process.env.defaultsFlags}`
      : 'But no defaults flags available in the environment!')
    return 0
  }

  try {
    info('Trying to restore defaults from artifact')
    await restoreDefaultConfig() // this fails
    info('Defaults restored from artifact')
    return 0
  } catch (err: unknown) {
    // throws an error with message containing 'Unable to find' if artifact does not exist
    if (err instanceof Error && !err.message.includes('Unable to find')) throw err
    // continue with downloading defaults and upload as artifact
    info('Downloading defaults')
    await downloadDefaultConfig(server, apiURL, version, token, owner, repository, customDefaultsPaths)
    return 0
  }
}

export async function downloadDefaultConfig (server: string, apiURL: string, version: string, token: string, owner: string, repository: string, customDefaultsPaths: string): Promise<UploadResponse> {
  let defaultsPaths: string[] = []

  // version: devel:.....
  if (version.startsWith('devel:')) {
    version = 'latest'
  }
  const enterpriseDefaultsURL = await getEnterpriseConfigUrl(DEFAULT_CONFIG, apiURL, version, token, owner, repository)
  if (enterpriseDefaultsURL !== '') {
    defaultsPaths = defaultsPaths.concat([enterpriseDefaultsURL])
  }

  const customDefaultsPathsArray = customDefaultsPaths !== '' ? customDefaultsPaths.split(',') : []
  defaultsPaths = defaultsPaths.concat(customDefaultsPathsArray)
  const defaultsPathsArgs = defaultsPaths.map((url) => ['--defaultsFile', url]).flat()

  const piperPath = internalActionVariables.piperBinPath
  if (piperPath === undefined) {
    throw new Error('Can\'t download default config: piperPath not defined!')
  }
  const flags: string[] = []
  flags.push(...defaultsPathsArgs)
  flags.push('--gitHubTokens', `${getHost(server)}:${token}`)
  const piperExec = await executePiper('getDefaults', flags)

  let defaultConfigs = JSON.parse(piperExec.output)
  if (customDefaultsPathsArray.length === 0) {
    defaultConfigs = [defaultConfigs]
  }

  const savedDefaultsPaths = saveDefaultConfigs(defaultConfigs)
  const uploadResponse = await uploadDefaultConfigArtifact(savedDefaultsPaths)
  exportVariable('defaultsFlags', generateDefaultConfigFlags(savedDefaultsPaths))
  return uploadResponse
}

interface DefaultConfig {
  filepath: string
  content: string
}

export function saveDefaultConfigs (defaultConfigs: DefaultConfig[]): string[] {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }

  const defaultsPaths = []
  try {
    for (const defaultConfig of defaultConfigs) {
      const configPath = path.join(CONFIG_DIR, path.basename(defaultConfig.filepath))
      fs.writeFileSync(configPath, defaultConfig.content)
      defaultsPaths.push(configPath)
    }

    return defaultsPaths
  } catch (err) {
    throw new Error(`Could not retrieve default configuration: ${err as string}`)
  }
}

export async function createCheckIfStepActiveMaps (actionCfg: ActionConfiguration): Promise<void> {
  info('creating maps with active stages and steps with checkIfStepActive')

  await downloadStageConfig(actionCfg)
    .then(async () => await checkIfStepActive('_', '_', true))
    .catch(err => {
      info(`checkIfStepActive failed: ${err as string}`)
    })
}

export async function downloadStageConfig (actionCfg: ActionConfiguration): Promise<void> {
  let stageConfigPath = ''
  if (actionCfg.customStageConditionsPath !== '') {
    info(`using custom stage conditions from ${actionCfg.customStageConditionsPath}`)
    stageConfigPath = actionCfg.customStageConditionsPath
  } else {
    info('using default stage conditions')
    stageConfigPath = await getEnterpriseConfigUrl(
      STAGE_CONFIG,
      actionCfg.gitHubEnterpriseApi,
      actionCfg.sapPiperVersion,
      actionCfg.gitHubEnterpriseToken,
      actionCfg.sapPiperOwner,
      actionCfg.sapPiperRepo)
    if (stageConfigPath === '') {
      throw new Error('Can\'t download stage config: failed to get URL!')
    }
  }

  const piperPath = internalActionVariables.piperBinPath
  if (piperPath === undefined) {
    throw new Error('Can\'t download stage config: piperPath not defined!')
  }
  const flags: string[] = ['--useV1']
  flags.push('--defaultsFile', stageConfigPath)
  flags.push('--gitHubTokens', `${getHost(actionCfg.gitHubEnterpriseServer)}:${actionCfg.gitHubEnterpriseToken}`)
  const piperExec = await executePiper('getDefaults', flags)
  const config = JSON.parse(piperExec.output)
  fs.writeFileSync(path.join(CONFIG_DIR, ENTERPRISE_STAGE_CONFIG_FILENAME), config.content)
}

export async function checkIfStepActive (stepName: string, stageName: string, outputMaps: boolean): Promise<number> {
  const flags: string[] = []
  flags.push('--stageConfig', path.join(CONFIG_DIR, ENTERPRISE_STAGE_CONFIG_FILENAME))
  if (outputMaps) {
    flags.push('--stageOutputFile', '.pipeline/stage_out.json')
    flags.push('--stepOutputFile', '.pipeline/step_out.json')
  }
  flags.push('--stage', stageName)
  flags.push('--step', stepName)

  const result = await executePiper('checkIfStepActive', flags)
  return result.exitCode
}

// ?
export async function restoreDefaultConfig (): Promise<void> {
  const artifactClient = artifact.create()
  const tempDir = path.join(CONFIG_DIR, 'defaults_temp')
  // throws an error with message containing 'Unable to find' if artifact does not exist
  await artifactClient.downloadArtifact(ARTIFACT_NAME, tempDir)

  const defaultsPaths: string[] = []
  try {
    const defaultsOrder = JSON.parse(fs.readFileSync(path.join(tempDir, 'defaults_order.json'), 'utf8'))
    defaultsOrder.forEach((defaultsFileName: string) => {
      const artifactPath = path.join(tempDir, defaultsFileName)
      const newPath = path.join(CONFIG_DIR, defaultsFileName)
      debug(`Moving ${artifactPath} to ${newPath}`)
      fs.renameSync(artifactPath, newPath)
      defaultsPaths.push(newPath)
    })
  } catch (err) {
    throw new Error(`Can't restore defaults: ${err as string}`)
  }

  exportVariable('defaultsFlags', generateDefaultConfigFlags(defaultsPaths))
  await Promise.resolve()
}

export async function uploadDefaultConfigArtifact (defaultsPaths: string[]): Promise<UploadResponse> {
  debug('uploading defaults as artifact')

  // order of (custom) defaults is important, so preserve it for when artifact is downloaded in another stage
  const orderedDefaultsPath = path.join(CONFIG_DIR, 'defaults_order.json')
  const defaultsFileNames = defaultsPaths.map((filePath) => path.basename(filePath))
  fs.writeFileSync(orderedDefaultsPath, JSON.stringify(defaultsFileNames))

  const artifactFiles = [...defaultsPaths, orderedDefaultsPath]
  debug(`uploading files ${JSON.stringify(artifactFiles)} in base directory ${CONFIG_DIR} to artifact with name ${ARTIFACT_NAME}`)

  const artifactClient = artifact.create()
  return await artifactClient.uploadArtifact(ARTIFACT_NAME, artifactFiles, CONFIG_DIR)
}

export function generateDefaultConfigFlags (paths: string[]): string[] {
  return paths.map((path) => ['--defaultConfig', path]).flat()
}

export async function readContextConfig (stepName: string, flags: string[]): Promise<any> {
  if (['version', 'help', 'getConfig', 'getDefaults'].includes(stepName)) {
    return {}
  }

  const stageName = process.env.GITHUB_JOB
  const piperPath = internalActionVariables.piperBinPath

  if (piperPath === undefined) {
    throw new Error('Can\'t get context config: piperPath not defined!')
  }
  if (stageName === undefined) {
    throw new Error('Can\'t get context config: stageName not defined!')
  }

  const getConfigFlags = ['--contextConfig', '--stageName', `${stageName}`, '--stepName', `${stepName}`]
  if (flags.includes('--customConfig')) {
    const flagIdx = flags.indexOf('--customConfig')
    const customConfigFlagValue = flags[flagIdx + 1]
    getConfigFlags.push('--customConfig', customConfigFlagValue)
  }

  const piperExec = await executePiper('getConfig', getConfigFlags)
  return JSON.parse(piperExec.output)
}
