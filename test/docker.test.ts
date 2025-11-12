import path from 'path'

import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as sidecar from '../src/sidecar'
import { internalActionVariables } from '../src/piper'
import type { ActionConfiguration } from '../src/config'
import {
  cleanupContainers,
  getOrchestratorEnvVars,
  getProxyEnvVars,
  getVaultEnvVars,
  getSystemTrustEnvVars,
  getTelemetryEnvVars,
  runContainers,
  startContainer,
  stopContainer,
  dockerExecReadOutput,
  getDockerImageFromEnvVar
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
    wdfGithubEnterpriseToken: '',
    dockerImage: '',
    dockerOptions: '',
    dockerEnvVars: '',
    sidecarImage: '',
    sidecarOptions: '',
    sidecarEnvVars: '',
    retrieveDefaultConfig: false,
    customDefaultsPaths: '',
    customStageConditionsPath: '',
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

    internalActionVariables.piperBinPath = piperPath
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    internalActionVariables.sidecarNetworkID = ''
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.sidecarContainerID = ''
  })

  test('Docker image name', async () => {
    internalActionVariables.piperBinPath = piperPath
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

  test('Start container without docker options', async () => {
    actionConfig.dockerImage = 'image1'
    const cwd = process.cwd()

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
      ...getSystemTrustEnvVars(),
      ...getTelemetryEnvVars(),
      ...getDockerImageFromEnvVar(actionConfig.dockerImage),
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
      ...getSystemTrustEnvVars(),
      ...getTelemetryEnvVars(),
      ...getDockerImageFromEnvVar(actionConfig.dockerImage),
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
      ...getSystemTrustEnvVars(),
      ...getTelemetryEnvVars(),
      ...getDockerImageFromEnvVar(ctxCfg.dockerImage),
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

    const expectedNetworkId = 'testNetworkId12345'
    internalActionVariables.sidecarNetworkID = expectedNetworkId
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
      ...getSystemTrustEnvVars(),
      ...getTelemetryEnvVars(),
      ...getDockerImageFromEnvVar(ctxCfg.dockerImage),
      ctxCfg.dockerImage,
      'cat'
    ]
    await startContainer(actionConfig, ctxCfg)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags, mockExecOptions)
  })

  test('Run container', async () => {
    actionConfig.dockerImage = 'dockerImg:123'
    await runContainers(actionConfig, {})
    expect(core.info).not.toHaveBeenCalledWith('Network created')
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Starting image ' + actionConfig.dockerImage + ' as container'))
  })

  test('Run containers with sidecar', async () => {
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
    internalActionVariables.dockerContainerID = expectedContainerId
    internalActionVariables.sidecarContainerID = expectedSidecarId
    internalActionVariables.sidecarNetworkID = expectedNetworkId
    await cleanupContainers()

    expect(exec.exec).toHaveBeenCalledWith('docker', ['stop', '--time=1', expectedContainerId], expect.anything())
    expect(exec.exec).toHaveBeenCalledWith('docker', ['stop', '--time=1', expectedSidecarId], expect.anything())
    expect(sidecar.removeNetwork).toHaveBeenCalledWith(expectedNetworkId)
  })

  test('dockerExecReadOutput with ignoreReturnCode', async () => {
    const dockerArgs = ['ps', '-a']
    const expectedOptions = expect.objectContaining({
      ignoreReturnCode: true,
      listeners: expect.objectContaining({
        stdout: expect.any(Function)
      })
    })

    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))

    await dockerExecReadOutput(dockerArgs)

    expect(exec.exec).toHaveBeenCalledWith('docker', dockerArgs, expectedOptions)
  })

  test('dockerExecReadOutput with non-zero exit code', async () => {
    const dockerArgs = ['invalid', 'command']

    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(1))

    await expect(dockerExecReadOutput(dockerArgs)).rejects.toThrow('docker execute failed with exit code')
  })
})
