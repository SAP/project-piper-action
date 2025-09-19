import { GITHUB_COM_SERVER_URL, getReleaseAssetUrl } from './github'
import { debug } from '@actions/core'

export const DEFAULT_CONFIG = 'DefaultConfig'
export const STAGE_CONFIG = 'StageConfig'
export const ENTERPRISE_DEFAULTS_FILENAME = 'piper-defaults.yml'
export const ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE = 'piper-defaults-github.yml'
export const ENTERPRISE_STAGE_CONFIG_FILENAME = 'piper-stage-config.yml'
const ENTERPRISE_STEPNAME_PREFIX = 'sap'

export function isEnterpriseStep (stepName: string, flags: string = ''): boolean {
  if (stepName === '') {
    // in this case OS Piper could be needed for getDefaults, checkIfStepActive etc
    return false
  }
  if (stepName === 'getConfig') {
    // in this case getConfig could be used to get enterprise step config
    if (flags.includes(`--stepName ${ENTERPRISE_STEPNAME_PREFIX}`) ||
        flags.includes(`--stepName=${ENTERPRISE_STEPNAME_PREFIX}`)) {
      return true
    }
  }
  return stepName.startsWith(ENTERPRISE_STEPNAME_PREFIX)
}

export function onGitHubEnterprise (): boolean {
  return process.env.GITHUB_SERVER_URL !== GITHUB_COM_SERVER_URL
}

export async function getEnterpriseConfigUrl (configType: string, apiURL: string, version: string, token: string, owner: string, repository: string): Promise<string> {
  debug('Getting enterprise config URL')
  if (configType !== DEFAULT_CONFIG && configType !== STAGE_CONFIG) return ''

  debug('initiating assetName and filename')
  let assetName: string = ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE
  let filename: string = ENTERPRISE_DEFAULTS_FILENAME

  if (configType === STAGE_CONFIG) {
    debug('configType is STAGE_CONFIG')
    assetName = ENTERPRISE_STAGE_CONFIG_FILENAME
    filename = ENTERPRISE_STAGE_CONFIG_FILENAME
  }

  // if version starts with devel: then it should use inner source Piper
  if (version.startsWith('devel:')) {
    version = 'latest'
  }
  // get URL of defaults from the release (gh api, authenticated)
  const [url] = await getReleaseAssetUrl(assetName, version, apiURL, token, owner, repository)
  if (url === '') {
    // fallback to get URL of defaults in the repository (unauthenticated)
    debug(`Fallback to get URL of defaults in the repository: ${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${filename}`)
    return `${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${filename}`
  }
  debug(`Returning enterprise config URL ${url}`)
  return url
}
