import * as path from 'path'
import * as fs from 'fs'
import { debug, exportVariable, getInput, info, type InputOptions } from '@actions/core'
import * as artifact from '@actions/artifact'
import { type UploadResponse } from '@actions/artifact'
import { executePiper } from './execute'
import {
  getHost,
  GITHUB_COM_API_URL,
  GITHUB_COM_SERVER_URL,
  PIPER_OWNER,
  PIPER_REPOSITORY
} from './github'
import {
  ENTERPRISE_DEFAULTS_FILENAME,
  ENTERPRISE_STAGE_CONFIG_FILENAME,
  DEFAULT_CONFIG,
  STAGE_CONFIG,
  getEnterpriseConfigUrl,
  onGitHubEnterprise
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
  wdfGithubEnterpriseToken: string
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

export async function getActionConfig (options: InputOptions): Promise<ActionConfiguration> {
  const getValue = (param: string, defaultValue?: string): string => {
    let value: string = getInput(param, options)
    if (value === '') {
      // EnVs should be provided like this
      // PIPER_ACTION_DOWNLOAD_URL
      value = process.env[`PIPER_ACTION_${param.toUpperCase().replace(/-/g, '_')}`] ?? ''
      if (value === '') return defaultValue ?? ''
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
    wdfGithubEnterpriseToken: getValue('wdf-github-enterprise-token'),
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

export async function getDefaultConfig (server: string, apiURL: string, version: string, token: string, owner: string, repository: string, customDefaultsPaths: string): Promise<void> {
  if (fs.existsSync(path.join(CONFIG_DIR, ENTERPRISE_DEFAULTS_FILENAME))) {
    info('Defaults are present')
    debug(process.env.defaultsFlags !== undefined
      ? `Defaults flags: ${process.env.defaultsFlags}`
      : 'But no defaults flags available in the environment!')
    return
  }

  try {
    info('Trying to restore defaults from artifact')
    await restoreDefaultConfig()
    info('Defaults restored from artifact')
  } catch (err: unknown) {
    // throws an error with message containing 'Unable to find' if artifact does not exist
    if (err instanceof Error && !err.message.includes('Unable to find')) throw err
    // continue with downloading defaults and upload as artifact
    info('Downloading defaults')
    await downloadDefaultConfig(server, apiURL, version, token, owner, repository, customDefaultsPaths)
  }
}

function processCustomDefaultsPath (path: string): string {
  // Handle HTTP URLs
  if (path.startsWith('http')) {
    return path
  }

  // Handle paths with org+repo and branch references (org/repo/some/path/to/config.yml@branch)
  const apiUrl = process.env.GITHUB_API_URL
  const branchMatch = path.match(/^(.+?)\/(.+?)\/(.+?)@(.+)$/)
  if (branchMatch !== null) {
    const [, org, repo, filePath, branch] = branchMatch
    return `${apiUrl}/repos/${org}/${repo}/contents/${filePath}?ref=${branch}`
  }

  // Others treated as paths to local files
  return path
}

export async function downloadDefaultConfig (server: string, apiURL: string, version: string, token: string, owner: string, repository: string, customDefaultsPaths: string): Promise<UploadResponse> {
  let defaultsPaths: string[] = []

  // Since defaults file is located in release assets, we will take it from latest release
  if (version.startsWith('devel:')) {
    version = 'latest'
  }
  const enterpriseDefaultsURL = await getEnterpriseConfigUrl(DEFAULT_CONFIG, apiURL, version, token, owner, repository)
  if (enterpriseDefaultsURL !== '') {
    defaultsPaths = defaultsPaths.concat([enterpriseDefaultsURL])
  }

  const customDefaultsPathsArray = customDefaultsPaths !== '' ? customDefaultsPaths.split(',') : []
  defaultsPaths = defaultsPaths.concat(
    customDefaultsPathsArray.map(path => processCustomDefaultsPath(path.trim()))
  )
  const defaultsPathsArgs = defaultsPaths.map((url) => ['--defaultsFile', url]).flat()

  const piperPath = internalActionVariables.piperBinPath
  if (piperPath === undefined) {
    throw new Error('Can\'t download default config: piperPath not defined!')
  }
  const flags: string[] = []
  flags.push(...defaultsPathsArgs)
  flags.push('--gitHubTokens', `${getHost(server)}:${token}`)
  const { stdout } = await executePiper('getDefaults', flags)
  let defaultConfigs = JSON.parse(stdout)
  if (customDefaultsPathsArray.length === 0) {
    defaultConfigs = [defaultConfigs]
  }
  // Ensure defaultConfigs is always an array
  if (!Array.isArray(defaultConfigs)) {
    defaultConfigs = [defaultConfigs]
  }

  // When saving files, sanitize filenames by removing query parameters
  const sanitizeFilename = (url: string): string => {
    try {
      const parsed = new URL(url)
      return path.basename(parsed.pathname)
    } catch {
      return path.basename(url)
    }
  }

  const savedDefaultsPaths = saveDefaultConfigs(defaultConfigs.map((config: DefaultConfig) => ({
    ...config,
    filepath: sanitizeFilename(config.filepath)
  })))
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
  const { stdout } = await executePiper('getDefaults', flags)
  const config = JSON.parse(stdout)
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
  if (['version', 'help', 'getConfig', 'getDefaults', 'writePipelineEnv'].includes(stepName)) {
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

  const { stdout } = await executePiper('getConfig', getConfigFlags)
  return JSON.parse(stdout)
}
