import { exec, type ExecOptions } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug, error } from '@actions/core'

export interface piperExecResult {
  output: string
  error: string
  exitCode: number
}

export async function executePiper (
  stepName: string, flags?: string[], ignoreDefaults?: boolean, execOptions?: ExecOptions
): Promise<piperExecResult> {
  let piperOutput = ''
  const piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        debug('about to print some data from options.listeners.stdout')
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          if (line.toLowerCase().includes('fatal')) {
            error(`${line}`) // GitHub Actions highlights this in red
          } else {
            piperOutput += `${line}\n`
          }
        })
      },
      stderr: (data: Buffer) => {
        debug('about to print some data from options.listeners.stderr')
        const outString = data.toString()
        outString.split('\n').forEach(line => {
          error(`${line}`) // Treat stderr as errors
          // TODO: what to do with piperError ?
          // piperError += `${line}\n`
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
