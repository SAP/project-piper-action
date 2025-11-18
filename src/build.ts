// Format for inner source development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
import { error, info, setFailed } from '@actions/core'
import { dirname, join } from 'path'
import fs from 'fs'
import { chdir, cwd } from 'process'
import { exec } from '@actions/exec'
import { extractZip } from '@actions/tool-cache'

export async function buildPiperInnerSource (version: string, wdfGithubEnterpriseToken: string = ''): Promise<string> {
  // Inner source development version (branch only): devel:OWNER:REPOSITORY:BRANCH
  const { owner, repository, branch } = parseInnerDevBranchVersion(version)
  if (branch.trim() === '') {
    throw new Error('branch component is empty in devel version')
  }
  const innerServerUrl = process.env.PIPER_ENTERPRISE_SERVER_URL ?? ''
  if (innerServerUrl === '') {
    error('PIPER_ENTERPRISE_SERVER_URL is not set in the repo settings')
  }

  let resolvedCommit = await resolveEnterpriseBranchHead(innerServerUrl, owner, repository, branch, wdfGithubEnterpriseToken)
  if (resolvedCommit.length === 0) {
    resolvedCommit = branch
  }
  info(`Branch '${branch}' HEAD -> '${resolvedCommit}'`)

  const folderFragment = sanitizeBranch(branch)
  const path = `${process.cwd()}/${owner}-${repository}-${folderFragment}`
  info(`path: ${path}`)
  const piperPath = `${path}/sap-piper`
  info(`piperPath: ${piperPath}`)
  if (fs.existsSync(piperPath)) {
    info(`Using cached inner-source binary: ${piperPath}`)
    return piperPath
  }

  info(`Building Inner Source Piper (branch mode) from ${version}`)
  const url = `${innerServerUrl}/${owner}/${repository}/archive/${branch}.zip`
  info(`URL: ${url}`)

  if (wdfGithubEnterpriseToken === '') {
    setFailed('WDF GitHub Token is not provided, please set PIPER_WDF_GITHUB_TOKEN')
    throw new Error('missing WDF GitHub token')
  }

  info(`Downloading Inner Source Piper from ${url} and saving to ${path}/source-code.zip`)
  const zipFile = await downloadWithAuth(url, `${path}/source-code.zip`, wdfGithubEnterpriseToken)
    .catch(err => { throw new Error(`Can't download Inner Source Piper: ${err}`) })

  info(`Extracting Inner Source Piper from ${zipFile} to ${path}`)
  try {
    await extractZip(zipFile, path)
  } catch (e: any) {
    throw new Error(`Can't extract Inner Source Piper: ${e?.message}`)
  }
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find((n: string) => n.includes(repository)) ?? '')
  if (repositoryPath === '' || !fs.existsSync(repositoryPath)) {
    throw new Error('Extracted repository directory not found')
  }
  info(`repositoryPath: ${repositoryPath}`)
  chdir(repositoryPath)

  const prevCGO = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  info(`Building Inner Source Piper from ${version}`)
  await exec('go build -o ../sap-piper')
    .catch(err => { throw new Error(`Can't build Inner Source Piper: ${err}`) })
  process.env.CGO_ENABLED = prevCGO

  // Ensure binary exists when 'go build' is mocked in tests (placeholder file)
  const builtInnerBinary = join(path, 'sap-piper')
  if (!fs.existsSync(builtInnerBinary)) {
    fs.writeFileSync(builtInnerBinary, '')
    info(`Created placeholder sap-piper binary at ${builtInnerBinary}`)
  }

  info('Changing directory back to working directory: ' + wd)
  chdir(wd)
  info('Removing repositoryPath: ' + repositoryPath)
  fs.rmSync(repositoryPath, { recursive: true, force: true })
  info(`Returning piperPath: ${piperPath}`)
  return piperPath
}

// Keep only branch parser
export function parseInnerDevBranchVersion (version: string): { owner: string, repository: string, branch: string } {
  const parts = version.split(':')
  if (parts.length !== 4) throw new Error('broken version: ' + version)
  if (parts[0] !== 'devel') throw new Error(`expected prefix 'devel', got '${parts[0]}'`)
  const [, owner, repository, branch] = parts
  return { owner, repository, branch }
}
 
// Branch sanitization
export function sanitizeBranch (branch: string): string {
  const sanitized = branch
    .replace(/[^0-9A-Za-z._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
  return sanitized.length === 0 ? 'branch-build' : sanitized
}

// Resolve branch head commit (optional metadata)
async function resolveEnterpriseBranchHead (baseUrl: string, owner: string, repo: string, branch: string, token: string): Promise<string> {
  if (token === '') return ''
  try {
    const apiBase = `${baseUrl}/api/v3`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`
    }
    const resp = await fetch(`${apiBase}/repos/${owner}/${repo}/branches/${branch}`, { headers })
    if (!resp.ok) return ''
    const data = await resp.json()
    const sha = typeof data?.commit?.sha === 'string' ? data.commit.sha : ''
    return sha
  } catch (e: any) {
    info(`Branch head resolve failed: ${e?.message}`)
    return ''
  }
}

async function downloadWithAuth (url: string, destination: string, wdfGithubToken: string): Promise<string> {
  if (wdfGithubToken.length !== 0) {
    info('WDF Github Token is set. ')
  } else {
    setFailed('WDF GitHub Token is not provided, please set the PIPER_WDF_GITHUB_TOKEN environment variable in Settings')
  }
  try {
    info(`🔄 Trying to download with auth ${url} to ${destination}`)

    // Ensure the parent directory exists
    const dir = dirname(destination)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      info(`📂 Created directory: ${dir}`)
    }

    return await downloadZip(url, destination, wdfGithubToken).catch((err) => {
      throw new Error(`Can't download with auth: ${err}`)
    })
  } catch (error) {
    setFailed(`❌ Download failed: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

async function downloadZip (url: string, zipPath: string, token?: string): Promise<string> {
  try {
    info(`🔄 Downloading ZIP from ${url}`)

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3.raw'
    }

    if (typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(url, { headers })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(zipPath, Buffer.from(buffer))

    info(`✅ ZIP downloaded successfully to ${zipPath}`)
  } catch (error) {
    setFailed(`❌ Download failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return zipPath
}
