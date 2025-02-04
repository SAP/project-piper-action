import fs from 'fs'

import * as core from '@actions/core'

import * as execute from '../src/execute'
import { exportPipelineEnv, loadPipelineEnv } from '../src/pipelineEnv'
import { type ExecOutput } from '@actions/exec'

describe('Config', () => {
  // since environment variables are used in tests, we reset them for every test in afterEach()
  const envClone = Object.assign({}, process.env)
  const testPipelineEnv = '{"pipelineId":"123"}'

  beforeEach(() => {
    process.env.piperPath = './piper'

    jest.spyOn(execute, 'executePiper').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0
    } as unknown as ExecOutput)

    jest.spyOn(core, 'setOutput')
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
    process.env = Object.assign({}, envClone)
  })

  test('Load pipelineEnv - success', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    process.env.PIPER_ACTION_PIPELINE_ENV = testPipelineEnv

    await loadPipelineEnv()

    expect(execute.executePiper).toHaveBeenCalled()
  })

  test('Load pipelineEnv - pipelineEnv already exists', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    process.env.PIPER_ACTION_PIPELINE_ENV = testPipelineEnv

    await loadPipelineEnv()

    expect(execute.executePiper).not.toHaveBeenCalled()
  })

  test('Load pipelineEnv - pipelineEnv input is undefined', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false)

    await loadPipelineEnv()

    expect(execute.executePiper).not.toHaveBeenCalled()
  })

  test('Export pipelineEnv - success', async () => {
    jest.spyOn(execute, 'executePiper').mockResolvedValueOnce({
      stdout: testPipelineEnv,
      stderr: '',
      exitCode: 0
    } as unknown as ExecOutput)

    await exportPipelineEnv(true)

    expect(execute.executePiper).toHaveBeenCalledWith('readPipelineEnv')
    expect(core.setOutput).toHaveBeenCalledWith('pipelineEnv', testPipelineEnv)
  })

  test('Export pipelineEnv - input not given', async () => {
    await exportPipelineEnv(false)

    expect(execute.executePiper).not.toHaveBeenCalled()
  })
})
