import { existsSync } from 'fs'
import { debug, setOutput } from '@actions/core'
import { executePiper } from './execute'
import { internalActionVariables } from './piper'

export async function loadPipelineEnv (): Promise<void> {
  // When running from subdirectory, CPE is in root .pipeline, not subdirectory .pipeline
  const workingDir = internalActionVariables.workingDir
  const isSubdirectory = workingDir !== '.' && workingDir !== ''
  const pipelineEnvPath = isSubdirectory
    ? '../.pipeline/commonPipelineEnvironment'
    : '.pipeline/commonPipelineEnvironment'

  if (existsSync(pipelineEnvPath) || process.env.PIPER_ACTION_PIPELINE_ENV === undefined) {
    debug(`Pipeline environment check: path=${pipelineEnvPath}, exists=${existsSync(pipelineEnvPath)}`)
    return
  }

  debug('Loading pipeline environment...')
  const pipelineEnv = process.env.PIPER_ACTION_PIPELINE_ENV
  const execOptions = { env: { PIPER_pipelineEnv: pipelineEnv } }

  await executePiper('writePipelineEnv', undefined, undefined, execOptions).catch(err => {
    throw new Error(`Can't load pipeline environment: ${err as string}`)
  })
}

export async function exportPipelineEnv (exportPipelineEnvironment: boolean): Promise<void> {
  if (!exportPipelineEnvironment) {
    return
  }

  debug('Exporting pipeline environment...')
  const piperExec = await executePiper('readPipelineEnv').catch(err => {
    throw new Error(`Can't export pipeline environment: ${err as string}`)
  })

  try {
    const pipelineEnv = JSON.stringify(JSON.parse((piperExec.stdout)))
    setOutput('pipelineEnv', pipelineEnv)
  } catch (err) {
    throw new Error(`Could not export pipeline environment: ${err as string}`)
  }
}
