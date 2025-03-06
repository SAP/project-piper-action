import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug, error, setOutput } from '@actions/core'

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  flags = !ignoreDefaults && process.env.defaultsFlags !== undefined
    ? flags.concat(JSON.parse(process.env.defaultsFlags))
    : flags

  const piperError = ''
  let stdoutBuffer: string = ''

  let options: ExecOptions = {
    ignoreReturnCode: true,
    listeners: {
      stdline: (data: string) => {
        if (data.includes('fatal')) {
          error(data)
          stdoutBuffer += data
        }
      },
      errline: (data: string) => {
        if (data.includes('fatal')) {
          error(data)
          stdoutBuffer += data
        }
      }
    }
  }
  options = Object.assign({}, options, execOptions)

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
  setOutput('stdout', stdoutBuffer)

  return await getExecOutput(binaryPath, args, options)
    .then((execOutput: ExecOutput) => (execOutput))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
