import { getTag, getReleaseAssetUrl } from '../src/github'
import { debug } from '@actions/core'
import * as exec from '@actions/exec'
import { downloadTool } from '@actions/tool-cache'
import { downloadAndSetOSPiper } from '../src/download'
import { internalActionVariables } from '../src/piper'
import type { ActionConfiguration } from '../src/config'
import * as fs from 'fs'

jest.mock('../src/fetch')
jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('../src/github', () => ({
  ...jest.requireActual('../src/github'),
  getReleaseAssetUrl: jest.fn()
}))
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  chmodSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false)
}))

const mockedGetReleaseAssetUrl = getReleaseAssetUrl as jest.MockedFunction<typeof getReleaseAssetUrl>
const mockedDownloadTool = downloadTool as jest.MockedFunction<typeof downloadTool>

describe('getTag', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return "latest" for empty version', () => {
    const result = getTag('', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "latest" for "master" version', () => {
    const result = getTag('master', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "latest" for "latest" version', () => {
    const result = getTag('latest', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "tags/version" for a specific version when forAPICall is true', () => {
    const result = getTag('v1.0.0', true)
    expect(result).toBe('tags/v1.0.0')
    expect(debug).toHaveBeenCalledWith('getTag returns: tags/v1.0.0')
  })

  it('should return "tag/version" for a specific version when forAPICall is false', () => {
    const result = getTag('v1.0.0', false)
    expect(result).toBe('tag/v1.0.0')
    expect(debug).toHaveBeenCalledWith('getTag returns: tag/v1.0.0')
  })
})

describe('downloadAndSetOSPiper', () => {
  const baseActionCfg: ActionConfiguration = {
    stepName: 'golangBuild',
    flags: '',
    piperVersion: '1.2.2',
    piperOwner: 'SAP',
    piperRepo: 'jenkins-library',
    sapPiperVersion: '1.2.3',
    sapPiperOwner: 'project-piper',
    sapPiperRepo: 'testRepo',
    gitHubServer: 'https://github.com',
    gitHubApi: 'https://api.github.com',
    gitHubToken: 'testGithubToken',
    gitHubEnterpriseServer: 'https://githubenterprise.test.com/',
    gitHubEnterpriseApi: 'https://api.githubenterprise.test.com/',
    gitHubEnterpriseToken: 'testToolsToken',
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
    exportPipelineEnvironment: false,
    workingDir: '.'
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    internalActionVariables.dockerContainerID = ''
    internalActionVariables.piperBinPath = ''
    mockedDownloadTool.mockImplementation(async (_url: string, dest?: string) => dest ?? './piper')
  })

  test('copies binary into Docker container when container is running', async () => {
    internalActionVariables.dockerContainerID = 'test-container-123'

    mockedGetReleaseAssetUrl.mockResolvedValue(['https://ghe.test/piper', '1.2.2'])
    const execSpy = (exec.exec as jest.Mock).mockResolvedValue(0)

    await downloadAndSetOSPiper(baseActionCfg)

    expect(internalActionVariables.piperBinPath).toContain('piper')
    expect(execSpy).toHaveBeenCalledWith('docker', expect.arrayContaining(['cp']))
  })

  test('does not call docker cp when no container is running', async () => {
    mockedGetReleaseAssetUrl.mockResolvedValue(['https://ghe.test/piper', '1.2.2'])
    const execSpy = (exec.exec as jest.Mock).mockResolvedValue(0)

    await downloadAndSetOSPiper(baseActionCfg)

    expect(internalActionVariables.piperBinPath).toContain('piper')
    expect(execSpy).not.toHaveBeenCalled()
  })

  test('tries GHE mirror first then falls back to github.com', async () => {
    mockedGetReleaseAssetUrl
      .mockRejectedValueOnce(new Error('mirror not available'))
      .mockResolvedValueOnce(['https://github.com/piper', '1.2.2'])

    await downloadAndSetOSPiper(baseActionCfg)

    expect(mockedGetReleaseAssetUrl).toHaveBeenCalledTimes(2)
    // First call: GHE mirror
    expect(mockedGetReleaseAssetUrl).toHaveBeenNthCalledWith(1,
      'piper', '1.2.2', 'https://api.githubenterprise.test.com/', 'testToolsToken', 'SAP', 'jenkins-library'
    )
    // Second call: github.com fallback
    expect(mockedGetReleaseAssetUrl).toHaveBeenNthCalledWith(2,
      'piper', '1.2.2', 'https://api.github.com', 'testGithubToken', 'SAP', 'jenkins-library'
    )
  })
})
