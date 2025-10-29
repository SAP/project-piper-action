import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug } from '@actions/core'

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  // If working directory is a subdirectory, adjust paths to point to root .pipeline
  const workingDir = internalActionVariables.workingDir
  if (workingDir !== '.' && workingDir !== '') {
    // Set envRootPath to ../.pipeline so Piper writes CPE files to root .pipeline
    flags.push('--envRootPath', '../.pipeline')
    debug(`Set envRootPath to ../.pipeline for subdirectory execution`)
  }

  if (!ignoreDefaults && process.env.defaultsFlags !== undefined) {
    let defaultFlags: string[] = JSON.parse(process.env.defaultsFlags)

    // Adjust .pipeline paths in default flags
    if (workingDir !== '.' && workingDir !== '') {
      defaultFlags = defaultFlags.map(flag => {
        if (flag.startsWith('.pipeline/')) {
          return '../' + flag
        }
        return flag
      })
      debug(`Adjusted default config paths for subdirectory: ${JSON.stringify(defaultFlags)}`)
    }

    flags = flags.concat(defaultFlags)
  }

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

  let options: ExecOptions = { ignoreReturnCode: true }
  options = Object.assign({}, options, execOptions)

  return await getExecOutput(binaryPath, args, options)
}
