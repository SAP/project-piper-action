import { debug, setOutput } from '@actions/core'
import { executePiper } from './execute'

export async function loadPipelineEnv (): Promise<void> {
  if (process.env.PIPER_ACTION_PIPELINE_ENV === undefined) {
    debug('PIPER_ACTION_PIPELINE_ENV is undefined, skipping pipeline environment load')
    return
  }

  debug('Loading pipeline environment...')
  const pipelineEnv = process.env.PIPER_ACTION_PIPELINE_ENV

  try {
    const parsed = JSON.parse(pipelineEnv)
    debug(`Pipeline environment contains ${Object.keys(parsed).length} keys`)
    // Log golang-specific keys for debugging
    const golangKeys = Object.keys(parsed).filter(k => k.startsWith('golang/'))
    if (golangKeys.length > 0) {
      debug(`Golang keys found: ${golangKeys.join(', ')}`)
      golangKeys.forEach(key => {
        debug(`  ${key}: ${parsed[key]}`)
      })
    } else {
      debug('WARNING: No golang keys found in pipeline environment!')
    }
  } catch (err) {
    debug(`Failed to parse pipeline environment JSON: ${err}`)
  }

  const execOptions = { env: { PIPER_pipelineEnv: pipelineEnv }, cwd: '.' }

  debug('Executing writePipelineEnv...')
  await executePiper('writePipelineEnv', undefined, undefined, execOptions).catch(err => {
    throw new Error(`Can't load pipeline environment: ${err as string}`)
  })
  debug('writePipelineEnv completed successfully')
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
