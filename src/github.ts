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

// Development version format (branch only): devel:OWNER:REPOSITORY:BRANCH
// Always treat REF as branch, resolve HEAD commit (best effort), download branch archive.
export async function buildPiperFromSource (version: string): Promise<string> {
  const { owner, repository, branch } = parseDevBranchVersion(version)
  if (!branch.trim()) {
    throw new Error('branch component is empty in devel version')
  }

  const resolvedCommit = await resolveBranchHead(owner, repository, branch) || branch
  debug(`Branch '${branch}' HEAD -> '${resolvedCommit}'`)

  const folderFragment = sanitizeBranch(branch)
  const path = `${process.cwd()}/${owner}-${repository}-${folderFragment}`
  const piperPath = `${path}/piper`
  if (fs.existsSync(piperPath)) {
    info(`Using cached Piper binary: ${piperPath}`)
    return piperPath
  }

  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true })
    info(`Created build directory: ${path}`)
  }

  info(`Building Piper (branch mode) from ${version}`)
  const url = `${GITHUB_COM_SERVER_URL}/${owner}/${repository}/archive/${branch}.zip`
  info(`Download URL: ${url}`)

  await extractZip(await downloadTool(url, `${path}/source-code.zip`), path)
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find(n => n.includes(repository)) ?? '')
  if (!repositoryPath) {
    throw new Error('Repository folder not found after extraction')
  }
  chdir(repositoryPath)

  const prevCGO = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  await exec(
    'go build -o ../piper',
    [
      '-ldflags',
      `-X github.com/SAP/jenkins-library/cmd.GitCommit=${resolvedCommit}
       -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}
       -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}`
    ]
  )
  process.env.CGO_ENABLED = prevCGO
  chdir(wd)
  fs.rmSync(repositoryPath, { recursive: true, force: true })
  return piperPath
}

function parseDevBranchVersion (version: string): { owner: string, repository: string, branch: string } {
  const parts = version.split(':')
  if (parts.length !== 4) throw new Error(`broken version: ${version}`)
  if (parts[0] !== 'devel') throw new Error(`expected prefix 'devel', got '${parts[0]}'`)
  const [, owner, repository, branch] = parts
  return { owner, repository, branch }
}

// SHA validation removed; branch always sanitized.
function sanitizeBranch (branch: string): string {
  return branch
    .replace(/[^0-9A-Za-z._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40) || 'branch-build'
}

async function resolveBranchHead (owner: string, repo: string, branch: string): Promise<string> {
  try {
    const octokit = new Octokit({})
    const resp = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner, repo, branch
    })
    return resp.status === 200 ? (resp.data.commit?.sha || '') : ''
  } catch (e: any) {
    debug(`resolveBranchHead failed: ${e?.message}`)
    return ''
  }
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
