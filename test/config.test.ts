import fs from 'fs'
import path from 'path'

import * as core from '@actions/core'
import * as artifact from '@actions/artifact'
import { type OctokitResponse } from '@octokit/types'

import * as config from '../src/config'
import * as execute from '../src/execute'
import * as github from '../src/github'
import { ENTERPRISE_DEFAULTS_FILENAME } from '../src/enterprise'

jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('@actions/artifact')
// mocking fs with GH Actions is somehow broken and the workaround doesn't seem to work
// https://github.com/actions/toolkit/issues/1075
// jest.mock('fs')
jest.mock('../src/execute')

interface piperExecResult {
  output: string
  error: string
  exitCode: number
}

describe('Config', () => {
  // piperExecResultMock is set as mock return value for the executePiper function before every test
  // it can be altered in individual tests, as the mock object is passed by reference
  // after every test, it gets reset to the default result object
  const defaultPiperExecResult: piperExecResult = {
    output: '',
    error: '',
    exitCode: 0
  }
  let piperExecResultMock = Object.assign({}, defaultPiperExecResult)

  // process.env gets altered during tests to set paths to defaults, so we need to reset it for every test in afterEach()
  const envClone = Object.assign({}, process.env)

  // helper function to generate executePiper output for 'piper getDefaults', which can be used to set the mock return value of the executePiper function
  const generatePiperGetDefaultsOutput = function (paths: string[]): piperExecResult {
    const piperExec = Object.assign({}, defaultPiperExecResult)
    if (paths.length === 1) {
      piperExec.output = `{"content":"general:\\n  vaultServerUrl: https://vault.acme.com\\n","filepath":"${paths[0]}"}\n`
    } else {
      const output: string[] = []
      for (const path of paths) {
        output.push(JSON.parse(`{"content":"general:\\n  vaultServerUrl: https://vault.acme.com\\n","filepath":"${path}"}\n`))
      }
      piperExec.output = JSON.stringify(output)
    }
    return piperExec
  }

  beforeEach(() => {
    process.env.piperPath = './piper'

    jest.spyOn(execute, 'executePiper').mockImplementation(async () => {
      return await Promise.resolve(piperExecResultMock)
    })

    jest.spyOn(artifact, 'create').mockReturnValue({
      uploadArtifact: async () => {
        return await Promise.resolve(0)
      },
      downloadArtifact: async () => {
        return await Promise.resolve(0)
      }
    } as unknown as artifact.ArtifactClient)

    jest.spyOn(fs, 'writeFileSync').mockReturnValue()

    jest.spyOn(core, 'exportVariable')
    jest.spyOn(config, 'restoreDefaultConfig')
    jest.spyOn(github, 'getReleaseAssetUrl').mockResolvedValue([`http://mock.test/asset/${ENTERPRISE_DEFAULTS_FILENAME}`, 'v1.0.0'])

    jest.spyOn(fs, 'writeFileSync').mockReturnValue()
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
    piperExecResultMock = defaultPiperExecResult
    process.env = Object.assign({}, envClone)
  })

  test('Get defaults', async () => {
    process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
    process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

    const server = 'https://github.anything.com'
    const host = 'github.anything.com'
    const sapDefaultsUrl = `http://mock.test/asset/${ENTERPRISE_DEFAULTS_FILENAME}`
    const expectedPiperFlags = ['--defaultsFile', `${sapDefaultsUrl}`, '--gitHubTokens', `${host}:blah-blah`]
    const expectedWrittenFilepath = path.join(config.CONFIG_DIR, ENTERPRISE_DEFAULTS_FILENAME)
    piperExecResultMock = generatePiperGetDefaultsOutput([sapDefaultsUrl])

    const errorCode = await config.downloadDefaultConfig(server, 'https://dummy-api.test/', 'v1.0.0', 'blah-blah', 'something', 'nothing', '')

    expect(errorCode).toBe(0)
    expect(execute.executePiper).toHaveBeenCalledWith('getDefaults', expectedPiperFlags)
    expect(core.exportVariable).toHaveBeenCalledWith('defaultsFlags', ['--defaultConfig', `${expectedWrittenFilepath}`])
    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedWrittenFilepath, expect.anything())
  })

  test('Get defaults and 1 custom defaults file', async () => {
    process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
    process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

    const server = 'https://github.anything.com'
    const host = 'github.anything.com'
    const sapDefaultsUrl = `http://mock.test/asset/${ENTERPRISE_DEFAULTS_FILENAME}`
    const customDefaultsPath = 'custom_defaults.yml'
    const allDefaultsPaths = [sapDefaultsUrl, customDefaultsPath]
    piperExecResultMock = generatePiperGetDefaultsOutput(allDefaultsPaths)

    const expectedDefaultsFileFlags = [sapDefaultsUrl, customDefaultsPath].map((path) => ['--defaultsFile', path]).flat()
    const expectedPiperFlags = [...expectedDefaultsFileFlags, '--gitHubTokens', `${host}:blah-blah`]
    const expectedWrittenFilepaths = allDefaultsPaths.map(defaultsPath => path.join(config.CONFIG_DIR, path.basename(defaultsPath)))
    const expectedExportedFilepaths = expectedWrittenFilepaths.map(defaultsPath => ['--defaultConfig', defaultsPath]).flat()

    const errorCode = await config.downloadDefaultConfig(server, 'https://dummy-api.test/', 'v1.0.0', 'blah-blah', 'something', 'nothing', customDefaultsPath)

    expect(errorCode).toBe(0)
    expect(execute.executePiper).toHaveBeenCalledWith('getDefaults', expectedPiperFlags)
    expect(core.exportVariable).toHaveBeenCalledWith('defaultsFlags', expectedExportedFilepaths)
    for (const filepath of expectedWrittenFilepaths) { expect(fs.writeFileSync).toHaveBeenCalledWith(filepath, expect.anything()) }
  })

  test('Get defaults and 2 custom defaults files', async () => {
    process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
    process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

    const server = 'https://github.anything.com'
    const host = 'github.anything.com'
    const sapDefaultsUrl = `http://mock.test/asset/${ENTERPRISE_DEFAULTS_FILENAME}`
    const customDefaultsPaths = ['custom_defaults.yml', 'custom_defaults2.yml']
    const allDefaultsPaths = [sapDefaultsUrl, ...customDefaultsPaths]
    piperExecResultMock = generatePiperGetDefaultsOutput(allDefaultsPaths)
    // workflow input is comma-separated

    const expectedDefaultsFileFlags = [sapDefaultsUrl, ...customDefaultsPaths].map((path) => ['--defaultsFile', path]).flat()
    const expectedPiperFlags = [...expectedDefaultsFileFlags, '--gitHubTokens', `${host}:blah-blah`]
    const expectedWrittenFilepaths = allDefaultsPaths.map(defaultsPath => path.join(config.CONFIG_DIR, path.basename(defaultsPath)))
    const expectedExportedFilepaths = expectedWrittenFilepaths.map(defaultsPath => ['--defaultConfig', defaultsPath]).flat()

    const errorCode = await config.downloadDefaultConfig(server, 'https://dummy-api.test/', 'v1.0.0', 'blah-blah', 'something', 'nothing', customDefaultsPaths.join(','))

    expect(errorCode).toBe(0)
    expect(execute.executePiper).toHaveBeenCalledWith('getDefaults', expectedPiperFlags)
    expect(core.exportVariable).toHaveBeenCalledWith('defaultsFlags', expectedExportedFilepaths)
    for (const filepath of expectedWrittenFilepaths) { expect(fs.writeFileSync).toHaveBeenCalledWith(filepath, expect.anything()) }
  })

  test('Read context config', async () => {
    process.env.GITHUB_JOB = 'Build'
    const stepName = 'mavenBuild'

    // 'piper getConfig --contextConfig' needs to return a JSON string
    piperExecResultMock.output = '{}'

    const expectedPiperFlags = ['--contextConfig', '--stageName', process.env.GITHUB_JOB, '--stepName', stepName]
    await config.readContextConfig(stepName, [])

    expect(execute.executePiper).toHaveBeenCalledWith('getConfig', expectedPiperFlags)

    delete process.env.GITHUB_JOB
  })
  test('Read context config with --customConfig flag', async () => {
    process.env.GITHUB_JOB = 'Build'
    const stepName = 'mavenBuild'

    // 'piper getConfig --contextConfig' needs to return a JSON string
    piperExecResultMock.output = '{}'

    await config.readContextConfig(stepName, ['some', 'other', 'flags', '--customConfig', '.pipeline/custom.yml'])
    const expectedPiperFlags = ['--contextConfig', '--stageName', process.env.GITHUB_JOB, '--stepName', stepName, '--customConfig', '.pipeline/custom.yml']

    expect(execute.executePiper).toHaveBeenCalledWith('getConfig', expectedPiperFlags)

    delete process.env.GITHUB_JOB
  })
  test('Download stage config', async () => {
    const mockContent = 'testbase64string'
    jest.spyOn(github, 'downloadFileFromGitHub').mockImplementationOnce(async () => {
      const response = { data: { content: Buffer.from(mockContent).toString('base64') } }
      return await Promise.resolve(response as unknown as OctokitResponse<any, number>)
    })

    await config.downloadStageConfig('testToken', 'something', 'nothing')

    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('.yml'), mockContent)
  })

  test('Check if step active', async () => {
    piperExecResultMock = {
      output: '',
      error: '',
      exitCode: 0
    }

    await config.checkIfStepActive('_', '_', true)

    expect(execute.executePiper).toHaveBeenCalledWith('checkIfStepActive', expect.arrayContaining(['--stageConfig', '--stageOutputFile', '--stepOutputFile']))
  })
  // TODO: fix this test
  test.skip('Create check if step active maps', async () => {
    jest.spyOn(config, 'downloadStageConfig').mockReturnValue(Promise.resolve())
    jest.spyOn(config, 'checkIfStepActive').mockReturnValueOnce(Promise.resolve(0))

    process.env.GITHUB_JOB = 'Init'

    await config.createCheckIfStepActiveMaps('testToken', 'something', 'nothing')

    expect(config.downloadStageConfig).toHaveBeenCalled()
    expect(config.checkIfStepActive).toHaveBeenCalled()

    delete process.env.GITHUB_JOB
  })
})
