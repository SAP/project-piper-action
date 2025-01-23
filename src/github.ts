import * as fs from 'fs'
import { join } from 'path'
import * as path from 'path'

import { chdir, cwd } from 'process'
import { Octokit } from '@octokit/core'
import { type OctokitOptions } from '@octokit/core/dist-types/types'
import { type OctokitResponse } from '@octokit/types'
import { downloadTool, extractZip } from '@actions/tool-cache'
import { debug, error, getInput, info, setFailed } from '@actions/core'
import { exec } from '@actions/exec'
import { isEnterpriseStep } from './enterprise'
import { fetchRetry } from './fetch'

export const GITHUB_COM_SERVER_URL = 'https://github.com'
export const GITHUB_WDF_SAP_SERVER_URL = 'https://github.wdf.sap.corp'
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

// Format for inner source development versions (all parts required): 'inner:GH_OWNER:REPOSITORY:COMMITISH'
export async function buildPiperInnerSource (version: string, githubToken: string): Promise<string> {
  const { owner, repository, commitISH } = parseDevVersion(version)
  const versionName = getVersionName(commitISH)

  const path = `${process.cwd()}/${owner}-${repository}-${versionName}`
  info(`path: ${path}`)
  const piperPath = `${path}/piper`
  info(`piperPath: ${piperPath}`)

  if (fs.existsSync(piperPath)) {
    info(`piperPath exists: ${piperPath}`)
    return piperPath
  }

  info(`Building Inner Source Piper from ${version}`)
  const url = `${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}/archive/${commitISH}.zip`
  info(`URL: ${url}`)

  info(`Downloading Inner Source Piper from ${url} and saving to ${path}/source-code.zip`)
  const zipFile = await downloadWithAuth(url, githubToken, `${path}/source-code.zip`)
    .catch((err) => {
      throw new Error(`Can't download Inner Source Piper: ${err}`)
    })

  info(`Listing cwd: ${cwd()}`)
  listFilesAndFolders(cwd())

  info(`Listing $path: ${path}`)
  listFilesAndFolders(path)

  info(`Extracting Inner Source Piper from ${zipFile} to ${path}`)
  await extractZip(zipFile, `${path}`).catch((err) => {
    throw new Error(`Can't extract Inner Source Piper: ${err}`)
  })
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find((name: string) => {
    return name.includes(repository)
  }) ?? '')
  info(`repositoryPath: ${repositoryPath}`)
  chdir(repositoryPath)

  const cgoEnabled = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  info(`Building Inner Source Piper from ${version}`)
  await exec(
    'go build -o ../piper',
    [
      '-ldflags',
      `-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitISH}
      -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}
      -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}`
    ]
  ).catch((err) => {
    throw new Error(`Can't build Inner Source Piper: ${err}`)
  })

  process.env.CGO_ENABLED = cgoEnabled

  info('Changing directory back to working directory: ' + wd)
  chdir(wd)
  info('Removing repositoryPath: ' + repositoryPath)
  fs.rmSync(repositoryPath, { recursive: true, force: true })
  // await downloadAndExtract(url, path)
  //
  // const repositoryPath = getRepositoryPath(path, PIPER_REPOSITORY)
  // await buildInnerBinary(repositoryPath, version, PIPER_OWNER, PIPER_REPOSITORY)
  //
  // fs.rmSync(repositoryPath, { recursive: true, force: true })

  info(`Returning piperPath: ${piperPath}`)
  return piperPath
}

async function downloadWithAuth (url: string, githubToken: string, destination: string): Promise<string> {
  try {
    info('🔄 Fetching pre-signed download URL...')

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3+json'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const downloadUrl = response.url // Get the redirected URL
    info(`🔗 Redirected URL: ${downloadUrl}`)

    const zipFile = await downloadTool(downloadUrl, destination)
    info(`✅ Downloaded successfully to ${zipFile}`)
    return zipFile
  } catch (error) {
    setFailed(`❌ Download failed: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

function listFilesAndFolders (dirPath: string): void {
  const items = fs.readdirSync(dirPath)
  items.forEach(item => {
    const fullPath = path.join(dirPath, item)
    const stats = fs.statSync(fullPath)
    info(stats.isDirectory() ? `📁 ${item}` : `📄 ${item} - ${stats.size} bytes`)
  })
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

// Format for development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
// export async function buildPiperFromSource (version: string): Promise<string> {
//   const { owner, repository, commitISH } = parseDevVersion(version)
//   const versionName = getVersionName(commitISH)
//   const path = `${process.cwd()}/${owner}-${repository}-${versionName}`
//   const piperPath = `${path}/piper`
//
//   if (fs.existsSync(piperPath)) return piperPath
//
//   // TODO: check if cache is available
//   info(`Building Piper from ${version}`)
//   const url = `${GITHUB_COM_SERVER_URL}/${owner}/${repository}/archive/${commitISH}.zip`
//   info(`URL: ${url}`)
//
//   await downloadAndExtract(url, path)
//
//   const repositoryPath = getRepositoryPath(path, repository)
//   await buildBinary(repositoryPath, commitISH, owner, repository)
//
//   fs.rmSync(repositoryPath, { recursive: true, force: true })
//   // TODO: await download cache
//
//   return piperPath
// }

// async function buildInnerBinary (repositoryPath: string, commitISH: string, owner: string, repository: string): Promise<void> {
//   const wd = cwd()
//   chdir(repositoryPath)
//
//   const cgoEnabled = process.env.CGO_ENABLED
//   process.env.CGO_ENABLED = '0'
//   await exec(
//     'go build -o ../piper',
//     [
//       '-ldflags',
//       `-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitISH}
//       -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}
//       -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}`
//     ]
//   )
//   process.env.CGO_ENABLED = cgoEnabled
//   chdir(wd)
// }
//
// async function buildBinary (repositoryPath: string, commitISH: string, owner: string, repository: string): Promise<void> {
//   const wd = cwd()
//   chdir(repositoryPath)
//
//   const cgoEnabled = process.env.CGO_ENABLED
//   process.env.CGO_ENABLED = '0'
//   await exec(
//     'go build -o ../piper',
//     [
//       '-ldflags',
//       `-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitISH}
//       -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}
//       -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}`
//     ]
//   )
//   process.env.CGO_ENABLED = cgoEnabled
//   chdir(wd)
// }

function getVersionName (commitISH: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(commitISH)) {
    throw new Error('Can\'t resolve COMMITISH, use SHA or short SHA')
  }
  return commitISH.slice(0, 7)
}
//
// async function downloadAndExtract (url: string, path: string): Promise<void> {
//   await extractZip(await downloadTool(url, `${path}/source-code.zip`), path)
// }
//
// function getRepositoryPath (path: string, repository: string): string {
//   return join(path, fs.readdirSync(path).find((name: string) => name.includes(repository)) ?? '')
// }

async function getPiperDownloadURL (piper: string, version?: string): Promise<string> {
  const tagURL = `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/${getTag(version, false)}`
  const response = await fetchRetry(tagURL, 'HEAD')
    .catch(async (err) => {
      throw new Error(`Can't get the tag: ${err}`)
    })
  return await Promise.resolve(response.url.replace(/tag/, 'download') + `/${piper}`)
}

async function getPiperBinaryNameFromInputs (isEnterpriseStep: boolean, version?: string): Promise<string> {
  if (version === 'master') {
    info('using _master binaries is deprecated. Using latest release version instead.')
  }
  return isEnterpriseStep ? 'sap-piper' : 'piper'
}

function getTag (version: string | undefined, forAPICall: boolean): string {
  if (version === undefined) return 'latest'

  version = version.toLowerCase()
  if (version === '' || version === 'master' || version === 'latest') return 'latest'
  return `${forAPICall ? 'tags' : 'tag'}/${version}`
}

export function parseDevVersion (version: string): { owner: string, repository: string, commitISH: string } {
  const versionComponents = version.split(':')
  if (versionComponents.length !== 4) {
    throw new Error('broken version: ' + version)
  }
  if (versionComponents[0] !== 'devel') {
    throw new Error('devel source version expected')
  }
  const [, owner, repository, commitISH] = versionComponents
  return { owner, repository, commitISH }
}
