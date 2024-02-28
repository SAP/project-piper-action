import { GITHUB_COM_SERVER_URL, getReleaseAssetUrl } from './github'

export const ENTERPRISE_DEFAULTS_FILENAME = 'piper-defaults.yml'
export const ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE = 'piper-defaults-github.yml'
export const ENTERPRISE_STAGE_CONFIG_FILENAME = 'github-stage-config.yml'

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

// deprecated, keep for backwards compatibility
export async function getEnterpriseDefaultsUrl (apiURL: string, version: string, token: string, owner: string, repository: string): Promise<string> {
  // get URL of defaults from the release (gh api, authenticated)
  const [enterpriseDefaultsURL] = await getReleaseAssetUrl(ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE, version, apiURL, token, owner, repository)
  if (enterpriseDefaultsURL !== '') return enterpriseDefaultsURL
  // fallback to get URL of defaults in the repository (unauthenticated)
  return `${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_DEFAULTS_FILENAME}`
}

export function getEnterpriseStageConfigUrl (owner: string, repository: string): string {
  if (onGitHubEnterprise() && owner !== '' && repository !== '') {
    return `${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_STAGE_CONFIG_FILENAME}`
  }
  return ''
}
