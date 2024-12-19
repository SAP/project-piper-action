import * as fs from 'fs'
import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { downloadTool } from '@actions/tool-cache'
import { debug, info } from '@actions/core'
import { isEnterpriseStep } from './enterprise'
import { fetchRetry } from './fetch'

export const GITHUB_COM_SERVER_URL = 'https://github.com'
export const GITHUB_COM_API_URL = 'https://api.github.com'
export const PIPER_OWNER = 'SAP'
export const PIPER_REPOSITORY = 'jenkins-library'

export function getHost (url: string): string {
  return url === '' ? '' : new URL(url).host
}

export async function downloadPiperBinary (
  stepName: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<string> {
  const isEnterprise = isEnterpriseStep(stepName)
  if (isEnterprise && token === '') throw new Error('Token is not provided for enterprise step')
  if (owner === '') throw new Error('owner is not provided')
  if (repo === '') throw new Error('repository is not provided')

  let binaryURL
  const headers: any = {}
  const piperBinaryName = await getPiperBinaryNameFromInputs(isEnterprise, version)
  if (token !== '') {
    debug('Fetching binary from GitHub API')
    headers.Accept = 'application/octet-stream'
    headers.Authorization = `token ${token}`

    const [binaryAssetURL, tag] = await getReleaseAssetUrl(piperBinaryName, version, apiURL, token, owner, repo)
    binaryURL = binaryAssetURL
    version = tag
  } else {
    debug('Fetching binary from URL')
    binaryURL = await getPiperDownloadURL(piperBinaryName, version)
    version = binaryURL.split('/').slice(-2)[0]
  }
  version = version.replace(/\./g, '_')
  const piperPath = `${process.cwd()}/${version}/${piperBinaryName}`
  if (fs.existsSync(piperPath)) {
    return piperPath
  }

  info(`Downloading '${binaryURL}' as '${piperPath}'`)
  await downloadTool(
    binaryURL,
    piperPath,
    undefined,
    headers
  )

  return piperPath
}

export async function getReleaseAssetUrl (
  assetName: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<[string, string]> {
  const getReleaseResponse = await getPiperReleases(version, apiURL, token, owner, repo)
  debug(`Found assets: ${getReleaseResponse.data.assets}`)
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
  const tag = getTag(true, version)
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

async function getPiperDownloadURL (piper: string, version?: string): Promise<string> {
  const tagURL = `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/${getTag(false, version)}`
  const response = await fetchRetry(tagURL, 'HEAD').catch(async (err) => {
    return await Promise.reject(new Error(`Can't get the tag: ${err}`))
  })
  return await Promise.resolve(response.url.replace(/tag/, 'download') + `/${piper}`)
}

async function getPiperBinaryNameFromInputs (isEnterpriseStep: boolean, version?: string): Promise<string> {
  let piper = 'piper'
  if (isEnterpriseStep) {
    piper = 'sap-piper'
  }
  if (version === 'master') {
    info('using _master binaries is deprecated. Using latest release version instead.')
  }
  return piper
}

function getTag (forAPICall: boolean, version: string | undefined): string {
  if (version === undefined) return 'latest'

  version = version.toLowerCase()
  if (version === '' || version === 'master' || version === 'latest') return 'latest'
  return `${forAPICall ? 'tags' : 'tag'}/${version}`
}
