import { existsSync } from 'fs'
import { debug, setOutput } from '@actions/core'
import { executePiper } from './execute'

export async function loadPipelineEnv (): Promise<void> {
  if (existsSync('.pipeline/commonPipelineEnvironment') || process.env.PIPER_ACTION_PIPELINE_ENV === undefined) {
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
