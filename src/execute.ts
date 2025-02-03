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
  const piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        notice('about to print some data from options.listeners.stdout')
        const outString = data.toString()
        if (outString.toLowerCase().includes('fatal')) {
          error(outString)
        } else {
          piperOutput += `${outString}\n`
        }
        // piperOutput += outString.toLowerCase().includes('fatal')
        //   ? `::error::${outString}\n`
        //   : `${outString}\n`
        notice('end printing data from options.listeners.stdout')
      },
      stderr: (data: Buffer) => {
        notice('about to print some data from options.listeners.stderr')
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          error(`${line}`) // Treat stderr as errors
          // TODO: what to do with piperError ?
          // piperError += `${line}\n`
        })
        notice('end printing data from options.listeners.stderr')
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
