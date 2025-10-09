import {
  type ActionConfiguration
} from './config'
import { internalActionVariables } from './piper'
import { downloadTool } from '@actions/tool-cache'
import { info, debug } from '@actions/core'
import { chmodSync, existsSync } from 'fs'
import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'

export async function prepareWorkhorseBinary (actionCfg: ActionConfiguration): Promise<void> {
  debug('Preparing Workhorse binary')
  const workhorsePath: string = await downloadWorkhorseBinary(actionCfg.artifactoryUrl, actionCfg.workhorseVersion)

  if (workhorsePath === undefined || workhorsePath === '') {
    throw new Error('Piper binary path is empty. Please check your action inputs.')
  }

  internalActionVariables.workhorseBinPath = workhorsePath
  debug('obtained workhorse binary at '.concat(workhorsePath))
  chmodSync(workhorsePath, 0o775)
}

async function downloadWorkhorseBinary (artifactoryUrl: string, version: string): Promise<string> {
  const workhorseBinaryName = 'workhorse'
  const workhorsePath = `${process.cwd()}/${version.replace(/\./g, '_')}/${workhorseBinaryName}`
  if (existsSync(workhorsePath)) {
    return workhorsePath
  }

  if (artifactoryUrl === '') {
    throw new Error('Artifactory URL for workhorse is not provided. Set it via input "artifactory-url" or environment variable "PIPER_ACTION_ARTIFACTORY_URL"')
  }
  if (version === '') {
    throw new Error('Version for workhorse is not provided. Set it via input "workhorse-version" or environment variable "PIPER_ACTION_WORKHORSE_VERSION"')
  }

  const downloadUrl = `${artifactoryUrl}/${version}/engine`
  info(`Downloading '${downloadUrl}' as '${workhorsePath}'`)
  await downloadTool(downloadUrl, workhorsePath)

  return workhorsePath
}

export async function executeWorkhorse (stepName: string, flags: string[] = []): Promise<ExecOutput> {
  let args: string[] = [stepName, ...flags]

  let options: ExecOptions = { ignoreReturnCode: true }
  return await getExecOutput(internalActionVariables.workhorseBinPath, args, options)
}
