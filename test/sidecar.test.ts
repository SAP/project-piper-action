import * as exec from '@actions/exec'
import * as core from '@actions/core'
import { createNetwork, parseDockerEnvVars, removeNetwork, startSidecar } from '../src/sidecar'
import { internalActionVariables } from '../src/piper'
import type { ActionConfiguration } from '../src/config'
import { getOrchestratorEnvVars, getProxyEnvVars, getVaultEnvVars } from '../src/docker'
import * as docker from '../src/docker'

jest.mock('@actions/core')

describe('Sidecar', () => {
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

  const expectedNetworkId = 'testNetworkId12345'

  beforeEach(() => {
    jest.spyOn(exec, 'exec').mockReturnValue(Promise.resolve(0))
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()

    internalActionVariables.sidecarNetworkID = ''
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.sidecarContainerID = ''
  })

  test('Start container without docker options', async () => {
    const sidecarImage = 'golang:1'
    internalActionVariables.sidecarNetworkID = expectedNetworkId

    const expectedDockerFlags = [
      'run',
      '--detach',
      '--rm',
      '--name', expect.anything(),
      '--network', expectedNetworkId,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      sidecarImage
    ]
    await startSidecar(actionConfig, '', sidecarImage)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags)
  })

  test('Start container with docker options from action config', async () => {
    const sidecarImage = 'golang:1'
    const actCfg = {
      sidecarOptions: '-u 0'
    }
    internalActionVariables.sidecarNetworkID = expectedNetworkId
    const expectedSideOptions = '-u 0'
    const expectedDockerFlags = [
      'run',
      '--detach',
      '--rm',
      ...expectedSideOptions.split(' '),
      '--name', expect.anything(),
      '--network', expectedNetworkId,
      ...getProxyEnvVars(),
      ...getOrchestratorEnvVars(),
      ...getVaultEnvVars(),
      sidecarImage
    ]
    await startSidecar(actCfg as ActionConfiguration, '', sidecarImage)

    expect(exec.exec).toHaveBeenCalledWith('docker', expectedDockerFlags)
  })

  test('Create network', async () => {
    jest.spyOn(docker, 'dockerExecReadOutput').mockResolvedValue('dockerOutput')
    const expectedDockerFlags = ['network', 'create', expect.anything()]

    await createNetwork()
    expect(docker.dockerExecReadOutput).toHaveBeenCalledWith(expectedDockerFlags)
    expect(core.info).toHaveBeenNthCalledWith(1, expect.stringContaining('Creating network'))
    expect(core.info).toHaveBeenNthCalledWith(2, 'Network created')
  })

  test('Create network fails', async () => {
    jest.spyOn(docker, 'dockerExecReadOutput').mockRejectedValue(Error('docker execute failed: '))
    const expectedDockerFlags = ['network', 'create', expect.anything()]

    await expect(createNetwork()).rejects.toEqual(Error('docker execute failed: '))
    expect(core.exportVariable).not.toHaveBeenCalled()
    expect(docker.dockerExecReadOutput).toHaveBeenCalledWith(expectedDockerFlags)
    expect(core.info).not.toHaveBeenCalledWith('Network created')
  })

  test('Parse docker env vars', async () => {
    const result1 = parseDockerEnvVars('{"testVar1": "val1"}', undefined)
    expect(result1).toEqual(['--env', 'testVar1=val1'])

    const result2 = parseDockerEnvVars('', '{"testVar1": "val1"}')
    expect(result2).toEqual(['--env', 'testVar1=val1'])

    const result3 = parseDockerEnvVars('', undefined)
    expect(result3).toEqual([])
  })

  test('Parse docker env vars not a JSON string', async () => {
    parseDockerEnvVars('not a JSON formatted string', undefined)
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('is not a JSON-formatted string'))
  })

  test('Remove network', async () => {
    await removeNetwork('')
    expect(core.debug).toHaveBeenCalledWith('no network to remove')
    expect(exec.exec).not.toHaveBeenCalled()

    process.env.PIPER_ACTION_dockerNetworkID = expectedNetworkId
    await removeNetwork(process.env.PIPER_ACTION_dockerNetworkID ?? '')
    expect(exec.exec).not.toHaveBeenCalledWith('docker', ['network', 'remove', expectedNetworkId])
  })
})
