import { exec, type ExecOptions } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { error, notice } from '@actions/core'

export interface piperExecResult {
  output: string
  error: string
  exitCode: number
}

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<piperExecResult> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  flags = !ignoreDefaults && process.env.defaultsFlags !== undefined
    ? flags.concat(JSON.parse(process.env.defaultsFlags))
    : flags

  const piperPath = internalActionVariables.piperBinPath
  const containerID = internalActionVariables.dockerContainerID

  let piperOutput = ''
  let piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          piperOutput += line.includes('fatal') ? `::error::${line}\n` : `${line}\n`
        })
      },
      stderr: (data: Buffer) => {
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          piperError += line.includes('fatal') ? `::error::${line}\n` : `${line}\n`
        })
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
    return await exec('docker', args, options)
      .then(exitCode => ({
        output: piperOutput.trim(),
        error: piperError.trim(),
        exitCode
      }))
      .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
  }

  const args: string[] = [stepName, ...flags]

  return await exec(piperPath, args, options)
    .then(exitCode => ({
      output: piperOutput,
      error: piperError,
      exitCode
    }))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
