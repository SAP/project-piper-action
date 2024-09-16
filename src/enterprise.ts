import { GITHUB_COM_SERVER_URL, getReleaseAssetUrl } from './github'

export const DEFAULT_CONFIG = 'DefaultConfig'
export const STAGE_CONFIG = 'StageConfig'
export const ENTERPRISE_DEFAULTS_FILENAME = 'piper-defaults.yml'
export const ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE = 'piper-defaults-github.yml'
export const ENTERPRISE_STAGE_CONFIG_FILENAME = 'piper-stage-config.yml'
const ENTERPRISE_STEPNAME_PREFIX = 'sap'

export function isEnterpriseStep (stepName: string): boolean {
  if (stepName === '') {
    // in this case OS Piper could be needed for getDefaults, checkIfStepActive etc
    return false
  }
  return stepName.startsWith(ENTERPRISE_STEPNAME_PREFIX)
}

export function onGitHubEnterprise (): boolean {
  return process.env.GITHUB_SERVER_URL !== GITHUB_COM_SERVER_URL
}

export async function getEnterpriseConfigUrl (configType: string, apiURL: string, version: string, token: string, owner: string, repository: string): Promise<string> {
  let assetname: string = ''
  let filename: string = ''

  if (configType === DEFAULT_CONFIG) {
    assetname = ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE
    filename = ENTERPRISE_DEFAULTS_FILENAME
  } else if (configType === STAGE_CONFIG) {
    assetname = ENTERPRISE_STAGE_CONFIG_FILENAME
    filename = ENTERPRISE_STAGE_CONFIG_FILENAME
  } else {
    return ''
  }

  // get URL of defaults from the release (gh api, authenticated)
  // const [url] = await getReleaseAssetUrl(assetname, version, apiURL, token, owner, repository)
  // if (url !== '') return url
  // fallback to get URL of defaults in the repository (unauthenticated)
  return `${process.env.GITHUB_API_URL}/repos/C5347299/${repository}/contents/resources/${filename}`
}
