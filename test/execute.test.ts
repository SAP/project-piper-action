import * as exec from '@actions/exec'

import { executePiper } from '../src/execute'
import { internalActionVariables } from '../src/piper'

jest.mock('@actions/exec')

describe('Execute', () => {
  const piperPath = './piper'
  const expectedOptions = { ignoreReturnCode: true }
  // The workflow runs in a job named 'units' and it's appended with '--stageName' to a Piper call,
  // therefore to pass tests locally as well, the env var is set
  const githubJob = process.env.GITHUB_JOB
  const stageNameArg = ['--stageName', 'units']

  beforeEach(() => {
    jest.spyOn(exec, 'getExecOutput').mockReturnValue(Promise.resolve({ stdout: 'testout', stderr: 'testerr', exitCode: 0 }))

    process.env.GITHUB_JOB = stageNameArg[1]

    internalActionVariables.piperBinPath = piperPath
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    process.env.GITHUB_JOB = githubJob

    internalActionVariables.sidecarNetworkID = ''
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.sidecarContainerID = ''
  })

  test('Execute Piper without flags', async () => {
    const stepName = 'version'

    const piperExec = await executePiper(stepName)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith(piperPath, [stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container without flags', async () => {
    const stepName = 'version'
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, undefined)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...stageNameArg], expectedOptions)
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with one flag', async () => {
    const stepName = 'version'
    const piperFlags = ['--verbose']
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })

  test('Execute Piper inside container with multiple flags', async () => {
    const stepName = 'mavenBuild'
    const piperFlags = ['--createBOM', '--globalSettingsFile', 'global_settings.xml']
    const dockerContainerID = 'testID'
    internalActionVariables.dockerContainerID = dockerContainerID

    const piperExec = await executePiper(stepName, piperFlags)
    expect(exec.getExecOutput).toHaveBeenCalledWith('docker', ['exec', dockerContainerID, '/piper/piper', stepName, ...piperFlags], expectedOptions)
    expect(piperFlags).toEqual(expect.arrayContaining(stageNameArg))
    expect(piperExec.exitCode).toBe(0)
  })
})
