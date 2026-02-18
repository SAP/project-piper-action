import * as fs from 'fs'
import { debug, info } from '@actions/core'
import { downloadTool, cacheFile, find } from '@actions/tool-cache'
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

  let resolvedVersion: string
  if (token !== '') {
    debug('Fetching binary from GitHub API')
    headers.Accept = 'application/octet-stream'
    headers.Authorization = `token ${token}`

    const [binaryAssetURL, tag] = await getReleaseAssetUrl(piperBinaryName, version, apiURL, token, owner, repo)
    debug(`downloadPiperBinary: binaryAssetURL: ${binaryAssetURL}, tag: ${tag}`)
    binaryURL = binaryAssetURL
    resolvedVersion = tag
  } else {
    debug('Fetching binary from URL')
    binaryURL = await getPiperDownloadURL(piperBinaryName, version)
    resolvedVersion = binaryURL.split('/').slice(-2)[0]
    debug(`downloadPiperBinary: binaryURL: ${binaryURL}, version: ${resolvedVersion}`)
  }

  // Try to find binary in tool cache first
  const toolName = `${owner}-${repo}-${piperBinaryName}`
  const cachedPath = find(toolName, resolvedVersion)
  if (cachedPath !== '') {
    const cachedBinary = `${cachedPath}/${piperBinaryName}`
    info(`Using cached binary from tool cache: ${cachedBinary}`)
    return cachedBinary
  }

  // Check if binary exists in current working directory (legacy support)
  const versionForPath = resolvedVersion.replace(/\./g, '_')
  const piperPath = `${process.cwd()}/${versionForPath}/${piperBinaryName}`
  if (fs.existsSync(piperPath)) {
    info(`Using existing binary: ${piperPath}`)
    return piperPath
  }

  info(`Downloading '${binaryURL}' to tool cache`)
  const downloadedPath = await downloadTool(
    binaryURL,
    undefined,
    undefined,
    headers
  )

  // Cache the downloaded binary using @actions/tool-cache
  info(`Caching binary as ${toolName}@${resolvedVersion}`)
  const cachedDir = await cacheFile(
    downloadedPath,
    piperBinaryName,
    toolName,
    resolvedVersion
  )

  const finalPath = `${cachedDir}/${piperBinaryName}`
  info(`Binary cached at: ${finalPath}`)
  return finalPath
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
