import path from 'path'

import * as exec from '@actions/exec'

import { startContainer } from '../src/docker'

jest.mock('@actions/core')
jest.mock('@actions/exec')

describe('Docker', () => {
  const piperPath = './piper'
  const expectedOptions = expect.objectContaining({ listeners: expect.anything() })
  const expectedOrchestratorEnvVars = [
    'GITHUB_ACTION',
    'GITHUB_ACTIONS',
    'GITHUB_JOB',
    'GITHUB_RUN_ID',
    'GITHUB_REF',
    'GITHUB_SERVER_URL',
    'GITHUB_API_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_SHA',
    'GITHUB_HEAD_REF',
    'GITHUB_BASE_REF',
    'GITHUB_EVENT_PULL_REQUEST_NUMBER',
    'PIPER_vaultAppRoleID',
    'PIPER_vaultAppRoleSecretID'
  ].map(i => '--env ' + i).join(' ').split(' ')

  beforeEach(() => {
    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  test('Start container without docker options', async () => {
    const config = { dockerImage: 'golang:1' }
    const cwd = process.cwd()
    process.env.piperPath = piperPath
    const expectedFlags = [
      'run',
      '--tty',
      '--detach',
      '--rm',
      '--user', '1000:1000',
      '--volume', `${cwd}:${cwd}`,
      '--volume', `${path.dirname(piperPath)}:/piper`,
      '--workdir', cwd,
      '--name', expect.anything(),
      ...expectedOrchestratorEnvVars,
      config.dockerImage,
      'cat'
    ]
    await startContainer(config.dockerImage, '', config)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedFlags, expectedOptions)
  })

  test('Start container with docker options from config', async () => {
    const config = { dockerImage: 'golang:1', dockerOptions: '-u 0' }
    const cwd = process.cwd()
    process.env.piperPath = piperPath
    const expectedDockerOptions = '-u 0'
    const expectedFlags = [
      'run',
      '--tty',
      '--detach',
      '--rm',
      '--user', '1000:1000',
      '--volume', `${cwd}:${cwd}`,
      '--volume', `${path.dirname(piperPath)}:/piper`,
      '--workdir', cwd,
      ...expectedDockerOptions.split(' '),
      '--name', expect.anything(),
      ...expectedOrchestratorEnvVars,
      config.dockerImage,
      'cat'
    ]
    await startContainer(config.dockerImage, config.dockerOptions, config)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedFlags, expectedOptions)
  })
})
