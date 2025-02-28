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
  // let stdoutBuffer: string = ''
  let stderrBuffer: string = ''
  let remainingStdout = ''

  let options: ExecOptions = {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        remainingStdout += data.toString()
        const lines: string[] = remainingStdout.split(/\r?\n/)

        // Keep the last line incomplete for the next chunk
        remainingStdout = lines.pop() ?? ''

        for (const line of lines) {
          if (line.includes('fatal')) {
            error(line)
            stderrBuffer += `::error::${line}\n`
          } else {
            // process.stdout.write(line + '\n')
            // stdoutBuffer += line + '\n'
          }
        }
      },
      stderr: (data: Buffer) => {
        process.stderr.write(data) // Keep stderr output as is
        stderrBuffer += data.toString()
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
  // setOutput('stdout', stdoutBuffer)
  setOutput('stderr', stderrBuffer)

  return await getExecOutput(binaryPath, args, options)
    .then((execOutput: ExecOutput) => (execOutput))
    .catch(err => { throw new Error(`Piper execution error: ${err as string}: ${piperError}`) })
}
