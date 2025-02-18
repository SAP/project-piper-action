// Format for inner source development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
import { error, info, setFailed } from '@actions/core'
import { dirname, join } from 'path'
import fs from 'fs'
import { chdir, cwd } from 'process'
import { exec } from '@actions/exec'
import { extractZip } from '@actions/tool-cache'

export async function buildPiperInnerSource (version: string, wdfGithubEnterpriseToken: string = ''): Promise<string> {
  const { owner, repository, commitISH } = parseDevVersion(version)
  const versionName = getVersionName(commitISH)

  const path = `${process.cwd()}/${owner}-${repository}-${versionName}`
  info(`path: ${path}`)
  const piperPath = `${path}/sap-piper`
  info(`piperPath: ${piperPath}`)

  if (fs.existsSync(piperPath)) {
    info(`piperPath exists: ${piperPath}`)
    return piperPath
  }

  info(`Building Inner Source Piper from ${version}`)
  const innerServerUrl = process.env.PIPER_ENTERPRISE_SERVER_URL ?? ''
  if (innerServerUrl === '') {
    error('PIPER_ENTERPRISE_SERVER_URL repository secret is not set. Add it in Settings of the repository')
  }
  const url = `${innerServerUrl}/${owner}/${repository}/archive/${commitISH}.zip`
  info(`URL: ${url}`)

  info(`Downloading Inner Source Piper from ${url} and saving to ${path}/source-code.zip`)
  const zipFile = await downloadWithAuth(url, `${path}/source-code.zip`, wdfGithubEnterpriseToken)
    .catch((err) => {
      throw new Error(`Can't download Inner Source Piper: ${err}`)
    })

  info(`Extracting Inner Source Piper from ${zipFile} to ${path}`)
  await extractZip(zipFile, `${path}`).catch((err) => {
    throw new Error(`Can't extract Inner Source Piper: ${err}`)
  })
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find((name: string) => name.includes(repository)) ?? '')
  info(`repositoryPath: ${repositoryPath}`)
  chdir(repositoryPath)

  const cgoEnabled = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  info(`Building Inner Source Piper from ${version}`)
  await exec('go build -o ../sap-piper')
    .catch((err) => {
      throw new Error(`Can't build Inner Source Piper: ${err}`)
    })

  process.env.CGO_ENABLED = cgoEnabled

  info('Changing directory back to working directory: ' + wd)
  chdir(wd)
  info('Removing repositoryPath: ' + repositoryPath)
  fs.rmSync(repositoryPath, { recursive: true, force: true })

  info(`Returning piperPath: ${piperPath}`)
  return piperPath
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

function getVersionName (commitISH: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(commitISH)) {
    throw new Error('Can\'t resolve COMMITISH, use SHA or short SHA')
  }
  return commitISH.slice(0, 7)
}
