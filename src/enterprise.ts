import { GITHUB_COM_SERVER_URL, getReleaseAssetUrl } from './github'
import { debug } from '@actions/core'

export const DEFAULT_CONFIG = 'DefaultConfig'
export const STAGE_CONFIG = 'StageConfig'
export const ENTERPRISE_DEFAULTS_FILENAME = 'piper-defaults.yml'
export const ENTERPRISE_DEFAULTS_FILENAME_ON_RELEASE = 'piper-defaults-github.yml'
export const ENTERPRISE_STAGE_CONFIG_FILENAME = 'piper-stage-config.yml'
const ENTERPRISE_STEPNAME_PREFIX = 'sap'

export interface PrereleaseConfig {
  owner: string
  repository: string
  version: string
  apiURL: string
  server: string
  token: string
}

/**
 * Parses a prerelease version string and returns the extracted configuration.
 * Format: prerelease:OWNER:REPO:TAG
 * Also applies enterprise server URL and token overrides from environment variables.
 */
export function parsePrereleaseVersion (
  version: string,
  defaultOwner: string,
  defaultRepository: string,
  defaultApiURL: string,
  defaultServer: string,
  defaultToken: string
): PrereleaseConfig {
  const parts = version.split(':')
  if (parts.length < 4 || parts[1] === '' || parts[2] === '' || parts[3] === '') {
    throw new Error(`Invalid prerelease version format: '${version}'. Expected format: 'prerelease:OWNER:REPO:TAG'`)
  }

  let apiURL = defaultApiURL
  let server = defaultServer
  let token = defaultToken

  const enterpriseServerUrl = process.env.PIPER_ENTERPRISE_SERVER_URL ?? ''
  if (enterpriseServerUrl !== '') {
    apiURL = `${enterpriseServerUrl}/api/v3`
    server = enterpriseServerUrl
  }

  const wdfToken = process.env.PIPER_ACTION_WDF_GITHUB_ENTERPRISE_TOKEN ?? ''
  if (wdfToken !== '') {
    token = wdfToken
  }

  return {
    owner: parts[1],
    repository: parts[2],
    version: parts[3],
    apiURL,
    server,
    token
  }
}

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
  // For prerelease versions, extract owner, repo, and tag from format: prerelease:OWNER:REPO:TAG
  // Also use PIPER_ENTERPRISE_SERVER_URL and enterprise token for prereleases
  if (version.startsWith('prerelease:')) {
    const config = parsePrereleaseVersion(version, owner, repository, apiURL, '', token)
    owner = config.owner
    repository = config.repository
    version = config.version
    apiURL = config.apiURL
    token = config.token
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
