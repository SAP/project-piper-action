import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import path from 'path'
import { internalActionVariables } from './piper'
import { debug } from '@actions/core'

export async function executePiper (
  stepName: string, flags: string[] = [], ignoreDefaults: boolean = false, execOptions?: ExecOptions
): Promise<ExecOutput> {
  if (process.env.GITHUB_JOB !== undefined) flags.push('--stageName', process.env.GITHUB_JOB)

  const workingDir = internalActionVariables.workingDir
  const containerID = internalActionVariables.dockerContainerID

  // Only adjust paths when running in Docker container with a subdirectory
  const isInContainer = containerID !== ''
  const isSubdirectory = workingDir !== '.' && workingDir !== ''

  // Commands that need envRootPath adjustment when in subdirectory:
  // - Commands in Docker: all commands need it to write to root .pipeline
  // - readPipelineEnv: needs to read from root .pipeline even when on host
  // - writePipelineEnv: needs to write to root .pipeline even when on host
  const needsEnvRootPath = isSubdirectory && (
    isInContainer ||
    stepName === 'readPipelineEnv' ||
    stepName === 'writePipelineEnv'
  )

  if (needsEnvRootPath) {
    // Set envRootPath to ../.pipeline so Piper writes/reads CPE files to/from root .pipeline
    flags.push('--envRootPath', '../.pipeline')
    debug(`Set envRootPath to ../.pipeline for step ${stepName} (container: ${isInContainer}, subdirectory: ${isSubdirectory})`)
  }

  if (!ignoreDefaults && process.env.defaultsFlags !== undefined) {
    let defaultFlags: string[] = JSON.parse(process.env.defaultsFlags)

    // Adjust .pipeline paths in default flags when running in container subdirectory
    if (isInContainer && isSubdirectory) {
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
