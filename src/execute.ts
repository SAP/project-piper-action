import { exec, type ExecOptions } from '@actions/exec'
import path from 'path'

export interface piperExecResult {
  output: string
  error: string
  exitCode: number
}

export async function executePiper (
    stepName: string, flags?: string[], ignoreDefaults?: boolean, execOptions?: ExecOptions
): Promise<piperExecResult> {
  const piperPath = process.env.piperPath
  if (piperPath === undefined) {
    throw new Error('Can\'t execute Piper: piperPath not defined!')
  }

  let piperOutput = ''
  let piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        piperOutput += data.toString()
      },
      stderr: (data: Buffer) => {
        piperError += data.toString()
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

  const containerID = process.env.PIPER_ACTION_dockerContainerID
  if (containerID === undefined) {
    return await exec(piperPath, [
          stepName,
          ...flags
        ],
        options)
        .then(exitCode => {
          return { output: piperOutput, error: piperError, exitCode }
        })
        .catch(err => {
          throw new Error(`Piper execution error: ${err as string}: ${piperError}`)
        })
  } else {
    return await exec('docker', [
      'exec',
      containerID,
      `/piper/${path.basename(piperPath)}`,
      stepName,
      ...flags
    ], options).then(exitCode => {
      return {
        output: piperOutput,
        error: piperError,
        exitCode
      }
    }).catch(err => {
      throw new Error(`Piper execution error: ${err as string}: ${piperError}`)
    })
  }
}
