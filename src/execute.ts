import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug } from '@actions/core'

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  process.env.PIPER_ACTION_VERSION = process.env.GITHUB_ACTION_REF ?? 'n/a'
  if (process.env.GITHUB_JOB !== undefined && !flags.includes('--stageName')) {
    flags.unshift('--stageName', process.env.GITHUB_JOB)
  }

  flags = !ignoreDefaults && process.env.defaultsFlags !== undefined
    ? flags.concat(JSON.parse(process.env.defaultsFlags))
    : flags

  const piperPath = internalActionVariables.piperBinPath
  const containerID = internalActionVariables.dockerContainerID

  // Default to Piper
  let binaryPath = piperPath
  let args: string[] = [stepName, ...flags]

  if (containerID !== '') { // Running in a container
    debug(`containerID: ${containerID}, running in docker`)
    binaryPath = 'docker'
    args = [
      'exec',
      containerID,
      `/piper/${path.basename(piperPath)}`,
      stepName,
      ...flags
    ]
  }

  let options: ExecOptions = { ignoreReturnCode: true }
  options = Object.assign({}, options, execOptions)

  return await getExecOutput(binaryPath, args, options)
}
