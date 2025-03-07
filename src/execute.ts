import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug, info, setFailed } from '@actions/core'
import { Writable } from 'stream'

class NullWriter extends Writable {
  _write (chunk: any, encoding: string, callback: any): void {}
}
// Used to suppress output from 'exec' and 'getExecOutput'
const nullWriter = new NullWriter()

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  flags = !ignoreDefaults && process.env.defaultsFlags !== undefined
    ? flags.concat(JSON.parse(process.env.defaultsFlags))
    : flags

  let piperError = ''

  let options: ExecOptions = {
    outStream: nullWriter,
    errStream: nullWriter,
    ignoreReturnCode: true,
    listeners: {
      stdline: (data: string) => {
        if (data.includes('fatal')) {
          piperError += data
          setFailed(data)
        } else { info(data) }
      },
      errline: (data: string) => {
        if (data.includes('fatal')) {
          piperError += data
          setFailed(data)
        } else { info(data) }
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

  return await getExecOutput(binaryPath, args, options)
    .then((execOutput: ExecOutput) => (execOutput))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
