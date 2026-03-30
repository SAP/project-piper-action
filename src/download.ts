import * as fs from 'fs'
import { debug, info } from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import {
  getDownloadUrlByTag,
  getReleaseAssetUrl
} from './github'
import { fetchRetry } from './fetch'
import type { ActionConfiguration } from './config'
import { chmodSync } from 'fs'
import { exec } from '@actions/exec'
import { basename } from 'path'
import { internalActionVariables } from './piper'

export async function downloadSapPiper (version: string, apiURL: string, token: string, owner: string, repo: string): Promise<string> {
  if (token === '') throw new Error('Token is not provided for enterprise step')
  if (owner === '') throw new Error('owner is not provided')
  if (repo === '') throw new Error('repository is not provided')

  debug(`version: ${version}`)
  debug('Fetching binary from GitHub API')
  const headers: any = {
    Accept: 'application/octet-stream',
    Authorization: `token ${token}`
  }

  const [binaryAssetURL, tag] = await getReleaseAssetUrl('sap-piper', version, apiURL, token, owner, repo)
  debug(`downloadSapPiper: binaryAssetURL: ${binaryAssetURL}, tag: ${tag}`)

  const versionDir = tag.replace(/\./g, '_')
  const piperPath = `${process.cwd()}/${versionDir}/sap-piper`
  if (fs.existsSync(piperPath)) {
    return piperPath
  }

  info(`Downloading '${binaryAssetURL}' as '${piperPath}'`)
  await downloadTool(binaryAssetURL, piperPath, undefined, headers)

  return piperPath
}

export async function downloadOSPiper (version: string, apiURL: string, token: string, owner: string, repo: string): Promise<string> {
  if (owner === '') throw new Error('owner is not provided')
  if (repo === '') throw new Error('repository is not provided')

  let binaryURL: string
  const headers: any = {}
  debug(`version: ${version}`)
  if (token !== '') {
    debug('Fetching binary from GitHub API')
    headers.Accept = 'application/octet-stream'
    headers.Authorization = `token ${token}`

    const [binaryAssetURL, tag] = await getReleaseAssetUrl('piper', version, apiURL, token, owner, repo)
    debug(`downloadOSPiper: binaryAssetURL: ${binaryAssetURL}, tag: ${tag}`)
    binaryURL = binaryAssetURL
    version = tag
  } else {
    debug('Fetching binary from URL')
    binaryURL = await getPiperDownloadURL('piper', version)
    version = binaryURL.split('/').slice(-2)[0]
    debug(`downloadOSPiper: binaryURL: ${binaryURL}, version: ${version}`)
  }

  version = version.replace(/\./g, '_')
  const piperPath = `${process.cwd()}/${version}/piper`
  if (fs.existsSync(piperPath)) return piperPath

  info(`Downloading '${binaryURL}' as '${piperPath}'`)
  await downloadTool(binaryURL, piperPath, undefined, headers)

  return piperPath
}

async function downloadOSPiperWithFallback (actionCfg: ActionConfiguration): Promise<string> {
  // Try GHE mirror first (SAP/jenkins-library on enterprise instance)
  if (actionCfg.gitHubEnterpriseApi !== '' && actionCfg.gitHubEnterpriseToken !== '') {
    try {
      info('Trying OS Piper download from GHE mirror')
      return await downloadOSPiper(actionCfg.piperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.piperOwner, actionCfg.piperRepo)
    } catch (err) {
      info(`GHE mirror download failed: ${err instanceof Error ? err.message : String(err)}, falling back to github.com`)
    }
  }

  // Fall back to public GitHub.com
  info('Downloading OS Piper from github.com')
  return await downloadOSPiper(actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}

export async function downloadAndSetOSPiper (actionCfg: ActionConfiguration): Promise<void> {
  info('Step not found in SAP Piper, switching to OS Piper')

  const osPiperPath = await downloadOSPiperWithFallback(actionCfg)
  chmodSync(osPiperPath, 0o775)
  internalActionVariables.piperBinPath = osPiperPath

  // If running in Docker, copy the OS Piper binary into the container's /piper/ mount
  const containerID = internalActionVariables.dockerContainerID
  if (containerID !== '') {
    info('Copying OS Piper binary into running container')
    await exec('docker', ['cp', osPiperPath, `${containerID}:/piper/${basename(osPiperPath)}`])
  }
}

export async function getPiperDownloadURL (piper: string, version: string): Promise<string> {
  try {
    const urlByTag = getDownloadUrlByTag(version)
    debug(`getDownloadUrlByTag returns: ${urlByTag}`)
    const response = await fetchRetry(urlByTag, 'HEAD')
    return response.url.replace(/tag/, 'download') + `/${piper}`
  } catch (err) {
    throw new Error(`Can't get the tag: ${(err as Error).message}`)
  }
}
