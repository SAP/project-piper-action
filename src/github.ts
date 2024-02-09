import * as fs from 'fs'
import { join } from 'path'
import { chdir, cwd } from 'process'
import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { downloadTool, extractZip } from '@actions/tool-cache'
import { info } from '@actions/core'
import { exec } from '@actions/exec'
import { isEnterpriseStep } from './enterprise'

export const GITHUB_COM_SERVER_URL = 'https://github.com'
export const GITHUB_COM_API_URL = 'https://api.github.com'
export const OS_PIPER_OWNER = 'SAP'
export const OS_PIPER_REPO = 'jenkins-library'

export function getHost (url: string): string {
  return url === '' ? '' : new URL(url).host
}

export async function downloadPiperBinary (stepName: string, version: string, apiURL: string, token: string, owner: string, repo: string): Promise<string> {
  const isEnterprise = isEnterpriseStep(stepName)
  if (isEnterprise && token === '') {
    throw new Error(`Token is not provided for enterprise step: ${stepName}`)
  }
  if (owner === '') {
    throw new Error('owner is not provided')
  }
  if (repo === '') {
    throw new Error('repository is not provided')
  }

  const piperBinaryName = await getPiperBinaryNameFromInputs(isEnterprise, version)
  const [assetUrl, tag] = await getReleaseAssetUrl(piperBinaryName, version, apiURL, token, owner, repo)
  const headers: any = {}
  headers.Accept = 'application/octet-stream'
  if (token !== '') {
    headers.Authorization = `token ${token}`
  }

  const piperBinaryDestPath = `${process.cwd()}/${tag.replace(/\./g, '_')}/${piperBinaryName}`
  if (fs.existsSync(piperBinaryDestPath)) {
    return piperBinaryDestPath
  }

  info(`Downloading binary ${piperBinaryName} into ${piperBinaryDestPath}`)
  await downloadTool(
    assetUrl,
    piperBinaryDestPath,
    undefined,
    headers
  )

  return piperBinaryDestPath
}

// Format for development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
export async function buildPiperFromSource (version: string): Promise<string> {
  const versionComponents = version.split(':')
  if (versionComponents.length !== 4) {
    throw new Error('broken version')
  }
  const
    owner = versionComponents[1]
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

// by default for inner source Piper
async function getPiperReleases (version: string, api: string, token: string, owner: string, repository: string): Promise<OctokitResponse<any>> {
  const tag = await getTag(true, version)

  const options: OctokitOptions = {}
  options.baseUrl = api
  if (token !== '') {
    options.auth = token
  }

  const octokit = new Octokit(options)
  info(`Getting releases from /repos/${owner}/${repository}/releases/${tag}`)
  const response = await octokit.request(`GET /repos/${owner}/${repository}/releases/${tag}`)
  if (response.status !== 200) {
    throw new Error(`can't get release by tag ${tag}: ${response.status}`)
  }

  return response
}

async function getPiperBinaryNameFromInputs (isEnterpriseStep: boolean, version?: string): Promise<string> {
  let piper = 'piper'
  if (isEnterpriseStep) {
    piper = 'sap-piper'
  }
  if (version === 'master') {
    piper += '_master'
  }
  return piper
}

async function getTag (forAPICall: boolean, version?: string): Promise<string> {
  if (version !== undefined) {
    version = version.toLowerCase()
  }

  let tag
  if (version === undefined || version === '' || version === 'master' || version === 'latest') {
    tag = 'latest'
  } else if (forAPICall) {
    tag = `tags/${version}`
  } else {
    tag = `tag/${version}`
  }

  return tag
}

// Expects a URL in API form:
// https://<host>/api/v3/repos/<org>/<repo>/contents/<folder>/<filename>
export async function downloadFileFromGitHub (url: string, token: string): Promise<OctokitResponse<any>> {
  const host = url.substring(0, url.indexOf('/repos'))
  const apiRequest = url.substring(url.indexOf('/repos'))

  const options: OctokitOptions = {}
  options.baseUrl = host
  if (token !== '') {
    options.auth = token
  } else {
    throw new Error('token is not provided')
  }
  const octokit = new Octokit(options)

  const response = await octokit.request(
    `GET ${apiRequest}`
  )
  if (response.status !== 200) {
    throw new Error(`can't get file: ${response.status}`)
  }

  return response
}

export async function getReleaseAssetUrl (
  assetName: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<[string, string]> {
  const getReleaseResponse = await getPiperReleases(version, apiURL, token, owner, repo)
  const url = getReleaseResponse.data.assets.find((asset: { name: string }) => {
    return asset.name === assetName
  }).url

  return [url, getReleaseResponse.data.tag_name]
}
