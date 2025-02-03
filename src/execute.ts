import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { notice } from '@actions/core'

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

  let piperError = ''
  let options = {
    listeners: {
      stdout: (data: Buffer) => {
        let outString: string = ''
        const inString: string = data.toString()
        inString.split('\n').forEach(line => {
          if (line.includes('fatal')) {
            notice(`stdout line contains fatal: ${line}`)
            outString += `::error::${line}\n`
          } else {
            outString += `${line}\n`
          }
        })
        data = Buffer.from(outString)
      },
      stderr: (data: Buffer) => {
        let outString: string = ''
        const inString = data.toString()
        inString.split('\n').forEach(line => {
          if (line.includes('fatal')) {
            notice(` stderr line contains fatal: ${line}`)
            outString += `::error::${line}\n`
            piperError += `::error::${line}\n`
          } else {
            outString += `${line}\n`
            piperError += `${line}\n`
          }
        })
        data = Buffer.from(outString)
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
      .then(({ stdout, stderr, exitCode }: ExecOutput) => ({
        output: stdout,
        error: stderr,
        exitCode
      }))
      .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
  }

  const args: string[] = [stepName, ...flags]

  return await getExecOutput(piperPath, args, options)
    .then(({ stdout, stderr, exitCode }: ExecOutput) => ({
      output: stdout,
      error: stderr,
      exitCode
    }))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
