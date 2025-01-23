// Format for inner source development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
import { parseDevVersion } from './github'
import { getInput, info, setFailed } from '@actions/core'
import { dirname, join } from 'path'
import fs from 'fs'
import { chdir, cwd } from 'process'
import { exec } from '@actions/exec'
import { extractZip } from '@actions/tool-cache'

export const GITHUB_WDF_SAP_SERVER_URL = 'https://github.wdf.sap.corp'

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
  const url = `${GITHUB_WDF_SAP_SERVER_URL}/${owner}/${repository}/archive/${commitISH}.zip`
  info(`URL: ${url}`)

  info(`Downloading Inner Source Piper from ${url} and saving to ${path}/source-code.zip`)
  const zipFile = await downloadWithAuth(url, `${path}/source-code.zip`, wdfGithubEnterpriseToken)
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
    'go build -o ../sap-piper',
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

  info(`Returning piperPath: ${piperPath}`)
  return piperPath
}

async function downloadWithAuth (url: string, destination: string, wdfGithubToken: string): Promise<string> {
  const token = getInput('wdf-github-enterprise-token', { required: true })
  if (token === '') {
    info('token from getInput is empty')
  } else {
    info('token from getInput: ' + token)
  }
  info('GH Token is: ' + wdfGithubToken)
  if (wdfGithubToken === '') {
    info('WDF GitHub Token is not provided, please set the PIPER_GITHUB_TOKEN environment variable in Settings')
    if (token === '') {
      setFailed('❌ GitHub Token is not provided, please set the PIPER_GITHUB_TOKEN environment variable in Settings')
    }
    wdfGithubToken = token
  }
  try {
    info(`🔄 Trying to download with auth ${url} to ${destination}`)

    // Ensure the parent directory exists
    const dir = dirname(destination)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      info(`📂 Created directory: ${dir}`)
    }

    const zipFile = await downloadZip(url, destination, wdfGithubToken).catch((err) => {
      throw new Error(`Can't download with auth: ${err}`)
    })
    info(`✅ Downloaded successfully to ${zipFile}`)
    return zipFile
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

function listFilesAndFolders (dirPath: string): void {
  const items = fs.readdirSync(dirPath)
  items.forEach(item => {
    const fullPath = join(dirPath, item)
    const stats = fs.statSync(fullPath)
    info(stats.isDirectory() ? `📁 ${item}` : `📄 ${item} - ${stats.size} bytes`)
  })
}

function getVersionName (commitISH: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(commitISH)) {
    throw new Error('Can\'t resolve COMMITISH, use SHA or short SHA')
  }
  return commitISH.slice(0, 7)
}
