import * as exec from '@actions/exec'

import { executePiper } from '../src/execute'
import { exportVariable } from '@actions/core'

jest.mock('@actions/exec')

describe('Config', () => {
  const piperPath = './piper'
  const expectedOptions = expect.objectContaining({ listeners: expect.anything() })
  // The workflow runs in a job named 'units' and it's appended with '--stageName' to a Piper call,
  // therefore to pass tests locally as well, the env var is set
  const githubJob = process.env.GITHUB_JOB
  const stageNameArg = ['--stageName', 'units']

  beforeEach(() => {
    process.env.GITHUB_JOB = stageNameArg[1]
    process.env.piperPath = piperPath
    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))
  })

  afterEach(() => {
    process.env.GITHUB_JOB = githubJob
    jest.resetAllMocks()
    jest.clearAllMocks()

    delete process.env.PIPER_ACTION_dockerContainerID
  })

  test('Execute Piper without flags', async () => {
    const stepName = 'version'

    const piperExec = await executePiper(stepName)
    expect(exec.exec).toHaveBeenCalledWith(piperPath, [stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.exec).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.exec).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container without flags', async () => {
    const stepName = 'version'
    exportVariable('PIPER_ACTION_dockerContainerID', 'testID')

    const piperExec = await executePiper(stepName, undefined)
    expect(exec.exec).toHaveBeenCalledWith('docker', ['exec', process.env.PIPER_ACTION_dockerContainerID, '/piper/piper', stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']
    exportVariable('PIPER_ACTION_dockerContainerID', 'testID')

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.exec).toHaveBeenCalledWith('docker', ['exec', process.env.PIPER_ACTION_dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']
    exportVariable('PIPER_ACTION_dockerContainerID', 'testID')

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.exec).toHaveBeenCalledWith('docker', ['exec', process.env.PIPER_ACTION_dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })
})
