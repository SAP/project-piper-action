import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { error } from '@actions/core'

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  flags = !ignoreDefaults && process.env.defaultsFlags !== undefined
    ? flags.concat(JSON.parse(process.env.defaultsFlags))
    : flags

  const piperPath = internalActionVariables.piperBinPath
  const containerID = internalActionVariables.dockerContainerID
  let piperError = ''
  let options = {
    listeners: {
      stdline: (data: string) => {
        if (data.includes('fatal')) {
          error(data)
          piperError += data
        }
      },
      errline: (data: string) => {
        if (data.includes('fatal')) {
          error(data)
          piperError += data
        }
      }
    }
  }
  options = Object.assign({}, options, execOptions)

  if (containerID !== '') { // Running in a container
    const args: string[] = [
      'exec',
      containerID,
      `/piper/${path.basename(piperPath)}`,
      stepName,
      ...flags
    ]
    return await getExecOutput('docker', args, options)
      .then((execOutput: ExecOutput) => (execOutput))
      .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
  }

  const args: string[] = [stepName, ...flags]

  return await getExecOutput(piperPath, args, options)
    .then((execOutput: ExecOutput) => (execOutput))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
