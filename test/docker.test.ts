import path from 'path'

import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as sidecar from '../src/sidecar'
import { type ActionConfiguration } from '../src/piper'
import {
  cleanupContainers,
  getOrchestratorEnvVars,
  getProxyEnvVars,
  getVaultEnvVars,
  runContainers,
  startContainer,
  stopContainer
} from '../src/docker'

jest.mock('@actions/core')
jest.mock('@actions/exec')

describe('Docker', () => {
  const actionConfig: ActionConfiguration = {
    stepName: '',
    flags: '',
    piperVersion: '',
    piperOwner: '',
    piperRepo: '',
    sapPiperVersion: '',
    sapPiperOwner: '',
    sapPiperRepo: '',
    gitHubServer: '',
    gitHubApi: '',
    gitHubToken: '',
    gitHubEnterpriseServer: '',
    gitHubEnterpriseApi: '',
    gitHubEnterpriseToken: '',
    dockerImage: '',
    dockerOptions: '',
    dockerEnvVars: '',
    sidecarImage: '',
    sidecarOptions: '',
    sidecarEnvVars: '',
    retrieveDefaultConfig: false,
    customDefaultsPaths: '',
    createCheckIfStepActiveMaps: false,
    exportPipelineEnvironment: false
  }
  const piperPath = './piper'
  const mockExecOptions = expect.objectContaining({ listeners: expect.anything() })
  const expectedDockerEnvVars = [
    '--env', 'var1',
    '--env', 'val2'
  ]

  beforeEach(() => {
    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))
    jest.spyOn(sidecar, 'parseDockerEnvVars').mockReturnValue(expectedDockerEnvVars)
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    delete process.env.piperPath
    delete process.env.PIPER_ACTION_dockerNetworkID
    delete process.env.PIPER_ACTION_dockerContainerID
    delete process.env.PIPER_ACTION_sidecarContainerID
  })

  test('Docker image name', async () => {
    process.env.piperPath = piperPath
    actionConfig.dockerImage = ''
    await startContainer(actionConfig, {})
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Starting image'))

    await startContainer(actionConfig, { dockerImage: '' })
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Starting image'))

    await startContainer(actionConfig, { dockerImage: 'image1:123' })
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Starting image image1:123 as container'))

    actionConfig.dockerImage = 'image1:321'
    await startContainer(actionConfig, { dockerImage: 'image1:123' })
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Starting image image1:321 as container'))
  })

  test('Piper path', async () => {
    actionConfig.dockerImage = 'image1'

    delete process.env.piperPath
    await expect(startContainer(actionConfig, {}))
      .rejects.toEqual(Error('piperPath environmental variable is undefined!'))

    process.env.piperPath = piperPath
    await startContainer(actionConfig, {})
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Starting image'))
  })

  test('Start container without docker options', async () => {
    actionConfig.dockerImage = 'image1'
    const cwd = process.cwd()
    process.env.piperPath = piperPath

    const expectedDockerFlags = [
      'run',
      '--tty',
      '--detach',
      '--rm',
      '--user', '1000:1000',
      '--volume', `${cwd}:${cwd}`,
      '--volume', `${path.dirname(piperPath)}:/piper`,
      '--workdir', cwd,
      '--name', expect.anything(),
      ...expectedDockerEnvVars,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      actionConfig.dockerImage,
      'cat'
    ]
    await startContainer(actionConfig, '')

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Start container with docker options from action config', async () => {
    actionConfig.dockerImage = 'image1'
    actionConfig.dockerOptions = '-u 0'
    const cwd = process.cwd()
    process.env.piperPath = piperPath

    const expectedDockerFlags = [
      'run',
      '--tty',
      '--detach',
      '--rm',
      '--user', '1000:1000',
      '--volume', `${cwd}:${cwd}`,
      '--volume', `${path.dirname(piperPath)}:/piper`,
      '--workdir', cwd,
      ...actionConfig.dockerOptions.split(' '),
      '--name', expect.anything(),
      ...expectedDockerEnvVars,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      actionConfig.dockerImage,
      'cat'
    ]
    await startContainer(actionConfig, '')

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Start container with docker options from ctx config', async () => {
    actionConfig.dockerImage = ''
    const ctxCfg = {
      dockerImage: 'golang:1',
      dockerOptions: '-u 0'
    }
    const cwd = process.cwd()
    process.env.piperPath = piperPath

    const expectedDockerOptions = '-u 0'
    const expectedDockerFlags = [
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
      ...expectedDockerEnvVars,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      ctxCfg.dockerImage,
      'cat'
    ]
    await startContainer(actionConfig, ctxCfg)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Start container with network configuration', async () => {
    const ctxCfg = {
      dockerImage: 'golang:1',
      dockerOptions: '-u 0',
      dockerName: 'testNetworkAlias12345'
    }
    const cwd = process.cwd()
    process.env.piperPath = piperPath

    const expectedNetworkId = 'testNetworkId12345'
    process.env.PIPER_ACTION_dockerNetworkID = expectedNetworkId
    const expectedNetworkAlias = 'testNetworkAlias12345'
    const expectedDockerOptions = '-u 0'
    const expectedDockerFlags = [
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
      '--network', expectedNetworkId,
      '--network-alias', expectedNetworkAlias,
      ...expectedDockerEnvVars,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      ctxCfg.dockerImage,
      'cat'
    ]
    await startContainer(actionConfig, ctxCfg)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Run container', async () => {
    process.env.piperPath = piperPath
    actionConfig.dockerImage = 'dockerImg:123'
    await runContainers(actionConfig, {})
    expect(core.info).not.toHaveBeenCalledWith('Network created')
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Starting image ' + actionConfig.dockerImage + ' as container'))
  })

  test('Run containers with sidecar', async () => {
    process.env.piperPath = piperPath
    actionConfig.sidecarImage = 'scImage:123'
    actionConfig.dockerImage = 'dockerImg:123'
    await runContainers(actionConfig, {})
    expect(core.info).toHaveBeenNthCalledWith(1, expect.stringContaining('Creating network'))
    expect(core.info).toHaveBeenNthCalledWith(2, expect.stringContaining('Starting image ' + actionConfig.sidecarImage + ' as sidecar'))
    expect(core.info).toHaveBeenNthCalledWith(3, expect.stringContaining('Starting image ' + actionConfig.dockerImage + ' as container'))
  })

  test('Stop container', async () => {
    const expectedContainerId = 'test1'
    const expectedDockerFlags = ['stop', '--time=1', expectedContainerId]
    await stopContainer(expectedContainerId)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Stop container no ID', async () => {
    const expectedContainerId = ''
    await stopContainer(expectedContainerId)

    expect(core.debug).toHaveBeenCalledWith('no container to stop')
    expect(exec.exec).not.toHaveBeenCalled()
  })

  test('cleanupContainers (nothing to clean)', async () => {
    jest.spyOn(sidecar, 'removeNetwork').mockImplementation()

    await cleanupContainers() // no PIPER_ACTION_dockerContainerID and PIPER_ACTION_sidecarContainerID
    expect(exec.exec).not.toHaveBeenCalled()
    expect(sidecar.removeNetwork).toHaveBeenCalled()
  })

  test('cleanupContainers normal', async () => {
    jest.spyOn(sidecar, 'removeNetwork').mockImplementation()

    const expectedContainerId = 'golang:1'
    const expectedSidecarId = 'sidecar:1'
    const expectedNetworkId = 'someNetworkId123'
    process.env.PIPER_ACTION_dockerContainerID = expectedContainerId
    process.env.PIPER_ACTION_sidecarContainerID = expectedSidecarId
    process.env.PIPER_ACTION_dockerNetworkID = expectedNetworkId
    await cleanupContainers()

    expect(exec.exec).toHaveBeenCalledWith('docker', ['stop', '--time=1', expectedContainerId], expect.anything())
    expect(exec.exec).toHaveBeenCalledWith('docker', ['stop', '--time=1', expectedSidecarId], expect.anything())
    expect(sidecar.removeNetwork).toHaveBeenCalledWith(expectedNetworkId)
    expect(process.env.PIPER_ACTION_dockerContainerID).toBeUndefined()
    expect(process.env.PIPER_ACTION_sidecarContainerID).toBeUndefined()
    expect(process.env.PIPER_ACTION_dockerNetworkID).toBeUndefined()
  })
})
