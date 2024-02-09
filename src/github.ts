import * as fs from 'fs'
import { join } from 'path'
import { chdir, cwd } from 'process'
import fetch from 'node-fetch'
import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { downloadTool, extractZip } from '@actions/tool-cache'
import { info } from '@actions/core'
import { exec } from '@actions/exec'
import { isEnterpriseStep } from './enterprise'
// import { restoreCache, saveCache } from '@actions/cache'

export const GITHUB_COM_SERVER_URL = 'https://github.com'
export const GITHUB_COM_API_URL = 'https://api.github.com'

export function getHost (url: string): string {
  return url === '' ? '' : new URL(url).host
}

export async function downloadPiperBinary (stepName: string, version: string, api: string, token: string, sapPiperOwner: string, sapPiperRepository: string): Promise<string> {
  if (token === undefined && isEnterpriseStep(stepName)) {
    throw new Error(`Token is not provided for enterprise step: ${stepName}`)
  }
  const piper = await getPiperBinaryNameFromInputs(stepName, version)
  let url, headers
  if (token !== undefined && token !== '') {
    const response = await getPiperReleases(isEnterpriseStep(stepName), version, api, token, sapPiperOwner, sapPiperRepository)
    url = response.data.assets.find((asset: { name: string }) => {
      return asset.name === piper
    }).url
    version = response.data.tag_name
    headers = {
      Authorization: `token ${token}`,
      Accept: 'application/octet-stream'
    }
  } else {
    url = await getPiperDownloadURL(piper, version)
    version = url.split('/').slice(-2)[0]
  }
  const piperPath = `${process.cwd()}/${version.replace(/\./g, '_')}/${piper}`
  if (fs.existsSync(piperPath)) {
    return piperPath
  }
  // let piperPathCached
  // if ((piperPathCached = await restorePiper(piperPath))) {
  //     return piperPathCached
  // }
  info(`Downloading ${piper}`)
  await downloadTool(
    url,
    piperPath,
    undefined,
    headers
  )
  // await savePiper(piperPath)
  return piperPath
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
    await downloadTool(url, `${path}/source-code.zip`),
      `${path}`
  )
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
async function getPiperReleases (isSAPStep: boolean, version: string, api: string, token: string, owner: string, repository: string): Promise<OctokitResponse<any, number>> {
  if (owner === '') {
    throw new Error('owner is not provided')
  }
  if (repository === '') {
    throw new Error('repository is not provided')
  }
  if (isSAPStep && token === '') {
    throw new Error('token is not provided')
  }
  const tag = await getTag(true, version)
  const options: OctokitOptions = {}
  options.baseUrl = api
  if (token !== '') {
    options.auth = token
  }
  const octokit = new Octokit(options)
  info(`Getting releases from /repos/${owner}/${repository}/releases/${tag}`)
  const response = await octokit.request(
        `GET /repos/${owner}/${repository}/releases/${tag}`
  )
  if (response.status !== 200) {
    throw new Error(`can't get commit: ${response.status}`)
  }
  return response
}

async function getPiperDownloadURL (piper: string, version?: string): Promise<string> {
  const response = await fetch(`${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/${await getTag(false, version)}`)
  if (response.status !== 200) {
    throw new Error(`can't get the tag: ${response.status}`)
  }
  return await Promise.resolve(response.url.replace(/tag/, 'download') + `/${piper}`)
}

async function getPiperBinaryNameFromInputs (stepName: string, version?: string): Promise<string> {
  let piper = 'piper'
  if (isEnterpriseStep(stepName)) {
    piper = 'sap-piper'
  }
  if (version === 'master') {
    piper += '_master'
  }
  return piper
}

async function getTag (forAPICall: boolean, version?: string): Promise<string> {
  let tag
  if (version !== undefined) {
    version = version.toLowerCase()
  }
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
export async function downloadFileFromGitHub (url: string, token: string): Promise<OctokitResponse<any, number>> {
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


