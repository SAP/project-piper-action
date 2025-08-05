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
  stepName: string, version: string, apiURL: string, token: string, owner: string, repo: string
): Promise<string> {
  const isEnterprise = isEnterpriseStep(stepName)
  if (isEnterprise && token === '') throw new Error('Token is not provided for enterprise step')
  if (owner === '') throw new Error('owner is not provided')
  if (repo === '') throw new Error('repository is not provided')

  const piperBinaryName: 'sap-piper' | 'piper' = isEnterprise ? 'sap-piper' : 'piper'

  if (version === 'master') info('using _master binaries is deprecated. Using latest release version instead.')
  version = (version === '' || version === 'master' || version === 'latest')
    ? 'latest'
    : version
  debug(`version: ${version}`)

  const piperPath = `${process.cwd()}/${version.replace(/\./g, '_')}/${piperBinaryName}`
  if (fs.existsSync(piperPath)) {
    debug(`Piper binary exists, skipping download: ${piperPath}`)
    return piperPath
  }
  info(`Piper binary does not exist, downloading: ${piperPath}`)

  let binaryURL: string
  const headers: any = {}
  if (token !== '') {
    debug('Fetching binary from GitHub API')
    headers.Accept = 'application/octet-stream'
    headers.Authorization = `token ${token}`

    const [binaryAssetURL, tag] = await getReleaseAssetUrl(piperBinaryName, version, apiURL, token, owner, repo)
    debug(`downloadPiperBinary: binaryAssetURL: ${binaryAssetURL}, tag: ${tag}`)
    binaryURL = binaryAssetURL
  } else {
    debug('Fetching binary from URL')
    binaryURL = await getPiperDownloadURL(piperBinaryName, version)
    debug(`downloadPiperBinary: binaryURL: ${binaryURL}, version: ${version}`)
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
