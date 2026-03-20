import * as fs from 'fs'
import { debug, info } from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import { isEnterpriseStep } from './enterprise'
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

export async function downloadPiperBinary (
  stepName: string, flags: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<string> {
  const isEnterprise = isEnterpriseStep(stepName, flags)
  if (isEnterprise && token === '') throw new Error('Token is not provided for enterprise step')
  if (owner === '') throw new Error('owner is not provided')
  if (repo === '') throw new Error('repository is not provided')

  let binaryURL: string
  const headers: any = {}
  const piperBinaryName: 'piper' | 'sap-piper' = await getPiperBinaryNameFromInputs(isEnterprise, version)
  debug(`version: ${version}`)
  if (token !== '') {
    debug('Fetching binary from GitHub API')
    headers.Accept = 'application/octet-stream'
    headers.Authorization = `token ${token}`

    const [binaryAssetURL, tag] = await getReleaseAssetUrl(piperBinaryName, version, apiURL, token, owner, repo)
    debug(`downloadPiperBinary: binaryAssetURL: ${binaryAssetURL}, tag: ${tag}`)
    binaryURL = binaryAssetURL
    version = tag
  } else {
    debug('Fetching binary from URL')
    binaryURL = await getPiperDownloadURL(piperBinaryName, version)
    version = binaryURL.split('/').slice(-2)[0]
    debug(`downloadPiperBinary: binaryURL: ${binaryURL}, version: ${version}`)
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

async function downloadOSPiperBinary (actionCfg: ActionConfiguration): Promise<string> {
  // Try GHE mirror first (SAP/jenkins-library on enterprise instance)
  if (actionCfg.gitHubEnterpriseApi !== '' && actionCfg.gitHubEnterpriseToken !== '') {
    try {
      info('Trying OS Piper download from GHE mirror')
      return await downloadPiperBinary('', '', actionCfg.piperVersion, actionCfg.gitHubEnterpriseApi, actionCfg.gitHubEnterpriseToken, actionCfg.piperOwner, actionCfg.piperRepo)
    } catch (err) {
      info(`GHE mirror download failed: ${err instanceof Error ? err.message : String(err)}, falling back to github.com`)
    }
  }

  // Fall back to public GitHub.com
  info('Downloading OS Piper from github.com')
  return await downloadPiperBinary('', '', actionCfg.piperVersion, actionCfg.gitHubApi, actionCfg.gitHubToken, actionCfg.piperOwner, actionCfg.piperRepo)
}

export async function downloadAndSetOSPiper (actionCfg: ActionConfiguration): Promise<void> {
  info('Step not found in SAP Piper, switching to OS Piper')

  const osPiperPath = await downloadOSPiperBinary(actionCfg)
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

async function getPiperBinaryNameFromInputs (isEnterpriseStep: boolean, version: string): Promise<'piper' | 'sap-piper'> {
  if (version === 'master') info('using _master binaries is deprecated. Using latest release version instead.')

  return isEnterpriseStep ? 'sap-piper' : 'piper'
}
