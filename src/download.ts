import * as fs from 'fs'
import { debug, info } from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import { isEnterpriseStep } from './enterprise'
import {
  getDownloadUrlByTag,
  getReleaseAssetUrl
} from './github'
import { fetchRetry } from './fetch'

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
