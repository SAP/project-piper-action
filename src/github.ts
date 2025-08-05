import * as fs from 'fs'
import { join } from 'path'
import { chdir, cwd } from 'process'
import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { downloadTool, extractZip } from '@actions/tool-cache'
import { debug, info } from '@actions/core'
import { exec } from '@actions/exec'

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

// Format for development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
export async function buildPiperFromSource (version: string): Promise<string> {
  const versionComponents = version.split(':')
  if (versionComponents.length !== 4) {
    throw new Error('broken version')
  }
  const owner = versionComponents[1]
  const repository = versionComponents[2]
  const commitISH = versionComponents[3]
  const versionName = (() => {
    if (!/^[0-9a-f]{7,40}$/.test(commitISH)) {
      throw new Error('Can\'t resolve COMMITISH, use SHA or short SHA')
    }
    return commitISH.slice(0, 7)
  })()
  const path = `${process.cwd()}/${owner}-${repository}-${versionName}`
  const piperPath = `${path}/piper`
  if (fs.existsSync(piperPath)) {
    return piperPath
  }
  // TODO
  // check if cache is available
  info(`Building Piper from ${version}`)
  const url = `${GITHUB_COM_SERVER_URL}/${owner}/${repository}/archive/${commitISH}.zip`
  info(`URL: ${url}`)

  await extractZip(
    await downloadTool(url, `${path}/source-code.zip`), `${path}`)
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find((name: string) => {
    return name.includes(repository)
  }) ?? '')
  chdir(repositoryPath)

  const cgoEnabled = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  await exec(
    'go build -o ../piper',
    [
      '-ldflags',
      `-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitISH}
      -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}
      -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}`
    ]
  )
  process.env.CGO_ENABLED = cgoEnabled
  chdir(wd)
  fs.rmSync(repositoryPath, { recursive: true, force: true })
  // TODO
  // await download cache
  return piperPath
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
  if (forAPICall) {
    return (version === '' || version === 'master' || version === 'latest')
      ? `${GITHUB_COM_API_URL}/repos/SAP/jenkins-library/releases/latest`
      : `${GITHUB_COM_API_URL}/repos/SAP/jenkins-library/releases/tags/${version}`
  }
  return (version === '' || version === 'master' || version === 'latest')
    ? `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/latest`
    : `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/tag/${version}`
}
