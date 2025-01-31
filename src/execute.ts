import { exec, type ExecOptions } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug, error, info } from '@actions/core'

export interface piperExecResult {
  output: string
  error: string
  exitCode: number
}

export async function executePiper (
  stepName: string, flags?: string[], ignoreDefaults?: boolean, execOptions?: ExecOptions
): Promise<piperExecResult> {
  let piperOutput = ''
  let piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        debug('about to print some data from options.listeners.stdout')
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          // TODO: This is a temporary fix to highlight errors in red
          // test if ::error:: should be appended to the piperOutput
          if (line.toLowerCase().includes('fatal')) {
            error(`::error::${line}`) // GitHub Actions highlights this in red
          } else {
            info(line)
          }
          piperOutput += line + '\n'
        })
      },
      stderr: (data: Buffer) => {
        debug('about to print some data from options.listeners.stderr')
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          error(`::error::${line}`) // Treat stderr as errors
          piperError += line + '\n'
        })
      }
    }
  }
  options = Object.assign({}, options, execOptions)

  flags = flags ?? []

  const stageName = process.env.GITHUB_JOB
  if (stageName !== undefined) {
    flags.push('--stageName', stageName)
  }

  const defaultsFlags = process.env.defaultsFlags
  if (ignoreDefaults !== false && defaultsFlags !== undefined) {
    flags = flags.concat(JSON.parse(defaultsFlags))
  }

  const piperPath = internalActionVariables.piperBinPath
  const containerID = internalActionVariables.dockerContainerID
  if (containerID !== '') { // Running in a container
    const args: string[] = [
      'exec',
      containerID,
      `/piper/${path.basename(piperPath)}`,
      stepName,
      ...flags

    ]
    return await exec('docker', args, options)
      .then(exitCode => {
        return {
          output: piperOutput,
          error: piperError,
          exitCode
        }
      })
      .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
  }

  const args: string[] = [stepName, ...flags]

  return await exec(piperPath, args, options)
    .then(exitCode => {
      return {
        output: piperOutput,
        error: piperError,
        exitCode
      }
    })
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}

function toRedConsole (message: string): string {
  return `\x1b[31m${message}\x1b[0m`
}
