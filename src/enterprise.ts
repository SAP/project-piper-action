import { GITHUB_COM_SERVER_URL } from './github'

export const ENTERPRISE_DEFAULTS_FILENAME = 'piper-defaults.yml'
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

export function getEnterpriseDefaultsUrl (owner: string, repository: string): string {
  if (onGitHubEnterprise() && owner !== '' && repository !== '') {
    return `${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_DEFAULTS_FILENAME}`
  }
  return ''
}

export function getEnterpriseStageConfigUrl (owner: string, repository: string): string {
  if (onGitHubEnterprise() && owner !== '' && repository !== '') {
    return `${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_STAGE_CONFIG_FILENAME}`
  }
  return ''
}
