import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { debug } from '@actions/core'

export const GITHUB_COM_SERVER_URL = 'https://github.com'
export const GITHUB_COM_API_URL = 'https://api.github.com'
export const PIPER_OWNER = 'SAP'
export const PIPER_REPOSITORY = 'jenkins-library'

export function getHost (url: string): string {
  return url === '' ? '' : new URL(url).host
}

export async function getReleaseAssetUrl (
  assetName: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<[string, string]> {
  const getReleaseResponse = await getPiperReleases(version, apiURL, token, owner, repo)
  debug(`Found assets: ${JSON.stringify(getReleaseResponse.data.assets)}`)
  debug(`Found tag: ${getReleaseResponse.data.tag_name}`)

  const tag = getReleaseResponse.data.tag_name // version of release
  const asset = getReleaseResponse.data.assets.find((asset: { name: string }) => {
    return asset.name === assetName
  })
  if (asset === undefined) {
    debug(`Asset not found: ${assetName}`)
    return ['', tag]
  }

  debug(`Found asset URL: ${asset.url} and tag: ${tag}`)
  return [asset.url, tag]
}

// by default for inner source Piper
async function getPiperReleases (version: string, api: string, token: string, owner: string, repository: string): Promise<OctokitResponse<any>> {
  const tag = getTag(version, true)
  const options: OctokitOptions = {}
  options.baseUrl = api
  if (token !== '') {
    options.auth = token
  }

  const octokit = new Octokit(options)
  debug(`Fetching release info from ${api}/repos/${owner}/${repository}/releases/${tag}`)
  const response = await octokit.request(`GET /repos/${owner}/${repository}/releases/${tag}`)
  if (response.status !== 200) {
    throw new Error(`can't get release by tag ${tag}: ${response.status}`)
  }

  return response
}

export function getTag (version: string, forAPICall: boolean): string {
  version = version.toLowerCase()
  if (version === '' || version === 'master' || version === 'latest') {
    debug('Using latest tag')
    return 'latest'
  }
  debug(`getTag returns: ${forAPICall ? 'tags' : 'tag'}/${version}`)
  return `${forAPICall ? 'tags' : 'tag'}/${version}`
}

export function getDownloadUrlByTag (version: string, forAPICall: boolean = false): string {
  version = version.toLowerCase()
  return (version === '' || version === 'master' || version === 'latest')
    ? `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/latest`
    : `${forAPICall ? `${GITHUB_COM_API_URL}/repos` : GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/${forAPICall ? 'tags' : 'tag'}/${version}`
}
