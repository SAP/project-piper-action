import fs from 'fs'
import path from 'path'
import {
  ENTERPRISE_DEFAULTS_FILENAME,
  ENTERPRISE_STAGE_CONFIG_FILENAME
} from '../src/enterprise'

import * as core from '@actions/core'
import * as artifact from '@actions/artifact'
import * as config from '../src/config'
import * as execute from '../src/execute'
import * as github from '../src/github'
import { type ExecOutput } from '@actions/exec'

jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
jest.mock('@actions/artifact')
// mocking fs with GH Actions is somehow broken and the workaround doesn't seem to work
// https://github.com/actions/toolkit/issues/1075
// jest.mock('fs')
jest.mock('../src/execute')

describe('Config', () => {
  // beforeEach(() => {
  //   jest.resetAllMocks()
  // })
  // piperExecResultMock is set as mock return value for the executePiper function before every test
  // it can be altered in individual tests, as the mock object is passed by reference
  // after every test, it gets reset to the default result object
  const defaultPiperExecResult: ExecOutput = {
    stdout: '',
    stderr: '',
    exitCode: 0
  }
  let piperExecResultMock = Object.assign({}, defaultPiperExecResult)

  // process.env gets altered during tests to set paths to defaults, so we need to reset it for every test in afterEach()
  const envClone = Object.assign({}, process.env)

  // helper function to generate executePiper output for 'piper getDefaults', which can be used to set the mock return value of the executePiper function
  const generatePiperGetDefaultsOutput = function (paths: string[]): ExecOutput {
    const piperExec = Object.assign({}, defaultPiperExecResult)
    if (paths.length === 1) {
      piperExec.stdout = `{"content":"general:\\n  vaultServerUrl: https://vault.acme.com\\n","filepath":"${paths[0]}"}\n`
    } else {
      const output: string[] = []
      for (const path of paths) {
        output.push(JSON.parse(`{"content":"general:\\n  vaultServerUrl: https://vault.acme.com\\n","filepath":"${path}"}\n`))
      }
      piperExec.stdout = JSON.stringify(output)
    }
    return piperExec
  }

  beforeEach(() => {
    process.env.piperPath = './piper'

    jest.spyOn(execute, 'executePiper').mockImplementation(async () => {
      return piperExecResultMock
    })

    jest.spyOn(artifact, 'create').mockReturnValue({
      uploadArtifact: async () => {
        return 0
      },
      downloadArtifact: async () => {
        return 0
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
    for (const filepath of expectedWrittenFilepaths) {
      expect(fs.writeFileSync).toHaveBeenCalledWith(filepath, expect.anything())
    }
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
    for (const filepath of expectedWrittenFilepaths) {
      expect(fs.writeFileSync).toHaveBeenCalledWith(filepath, expect.anything())
    }
  })

  test('Read context config', async () => {
    process.env.GITHUB_JOB = 'Build'
    const stepName = 'mavenBuild'

    // 'piper getConfig --contextConfig' needs to return a JSON string
    piperExecResultMock.stdout = '{}'

    const expectedPiperFlags = ['--contextConfig', '--stageName', process.env.GITHUB_JOB, '--stepName', stepName]
    await config.readContextConfig(stepName, [])

    expect(execute.executePiper).toHaveBeenCalledWith('getConfig', expectedPiperFlags)

    delete process.env.GITHUB_JOB
  })
  test('Read context config with --customConfig flag', async () => {
    process.env.GITHUB_JOB = 'Build'
    const stepName = 'mavenBuild'

    // 'piper getConfig --contextConfig' needs to return a JSON string
    piperExecResultMock.stdout = '{}'

    await config.readContextConfig(stepName, ['some', 'other', 'flags', '--customConfig', '.pipeline/custom.yml'])
    const expectedPiperFlags = ['--contextConfig', '--stageName', process.env.GITHUB_JOB, '--stepName', stepName, '--customConfig', '.pipeline/custom.yml']

    expect(execute.executePiper).toHaveBeenCalledWith('getConfig', expectedPiperFlags)

    delete process.env.GITHUB_JOB
  })

  test('Download stage config', async () => {
    // mock for stage config case
    jest.spyOn(github, 'getReleaseAssetUrl').mockResolvedValue([`http://mock.test/asset/${ENTERPRISE_STAGE_CONFIG_FILENAME}`, 'v1.0.0'])

    process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
    process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

    const server = 'https://github.anything.com'
    const host = 'github.anything.com'
    const sapStageConfigUrl = `http://mock.test/asset/${ENTERPRISE_STAGE_CONFIG_FILENAME}`
    const expectedPiperFlags = ['--useV1', '--defaultsFile', `${sapStageConfigUrl}`, '--gitHubTokens', `${host}:blah-blah`]
    const expectedWrittenFilepath = path.join(config.CONFIG_DIR, ENTERPRISE_STAGE_CONFIG_FILENAME)
    piperExecResultMock = generatePiperGetDefaultsOutput([sapStageConfigUrl])

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const actionCfg = {
      gitHubEnterpriseServer: server,
      gitHubEnterpriseApi: 'https://dummy-api.test/',
      sapPiperVersion: 'v1.0.0',
      gitHubEnterpriseToken: 'blah-blah',
      customStageConditionsPath: '',
      sapPiperOwner: 'something',
      sapPiperRepo: 'nothing'
    } as config.ActionConfiguration
    await config.downloadStageConfig(actionCfg)

    expect(execute.executePiper).toHaveBeenCalledWith('getDefaults', expectedPiperFlags)
    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedWrittenFilepath, expect.anything())
  })

  test('Check if step active', async () => {
    piperExecResultMock = {
      stdout: '',
      stderr: '',
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

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const actionCfg = {
      gitHubEnterpriseServer: 'server',
      gitHubEnterpriseApi: 'apiURL',
      sapPiperVersion: 'version',
      gitHubEnterpriseToken: 'testToken',
      sapPiperOwner: 'something',
      sapPiperRepo: 'nothing'
    } as config.ActionConfiguration
    await config.createCheckIfStepActiveMaps(actionCfg)

    expect(config.downloadStageConfig).toHaveBeenCalled()
    expect(config.checkIfStepActive).toHaveBeenCalled()

    delete process.env.GITHUB_JOB
  })

  test('Save default configs', () => {
    const defaultConfigs = [
      { content: 'config content 1', filepath: 'config1.yml' },
      { content: 'config content 2', filepath: 'config2.yml' }
    ]
    const expectedPaths = defaultConfigs.map(cfg => path.join(config.CONFIG_DIR, path.basename(cfg.filepath)))

    jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    jest.spyOn(fs, 'mkdirSync')
    jest.spyOn(fs, 'writeFileSync')

    const savedPaths = config.saveDefaultConfigs(defaultConfigs)

    expect(fs.existsSync).toHaveBeenCalledWith(config.CONFIG_DIR)
    expect(fs.mkdirSync).toHaveBeenCalledWith(config.CONFIG_DIR, { recursive: true })
    for (const [index, configPath] of expectedPaths.entries()) {
      expect(fs.writeFileSync).toHaveBeenCalledWith(configPath, defaultConfigs[index].content)
    }
    expect(savedPaths).toEqual(expectedPaths)
  })

  test('Process URLs with branch references', async () => {
    process.env.GITHUB_API_URL = 'https://github.tools.sap/api/v3'

    const customPaths = [
      '.pipeline/custom-defaults.yml',
      '../shared/config.yaml',
      'https://github.tools.sap/api/v3/repos/org/repo/config.yaml?ref=develop',
      'piper-test/demo-repo/custom/path/config.yaml@feature'
    ].join(',')

    piperExecResultMock = generatePiperGetDefaultsOutput([
      'http://mock.test/asset/piper-defaults.yml'
    ])

    const errorCode = await config.downloadDefaultConfig(
      'https://github.tools.sap',
      'https://github.tools.sap/api/v3',
      'v1.0.0',
      'token',
      'piper-test',
      'gha-demo-k8s-node',
      customPaths
    )

    expect(errorCode).toBe(0)
    expect(execute.executePiper).toHaveBeenCalledWith('getDefaults', expect.arrayContaining([
      '--defaultsFile',
      'http://mock.test/asset/piper-defaults.yml',
      '--defaultsFile',
      '.pipeline/custom-defaults.yml',
      '--defaultsFile',
      '../shared/config.yaml',
      '--defaultsFile',
      'https://github.tools.sap/api/v3/repos/org/repo/config.yaml?ref=develop',
      '--defaultsFile',
      'https://github.tools.sap/api/v3/repos/piper-test/demo-repo/contents/custom/path/config.yaml?ref=feature'
    ]))
  })

  test('Sanitizes filenames when saving', async () => {
    const paths = [
      'https://github.tools.sap/api/v3/repos/piper-test/gha-demo-k8s-node/contents/config.yaml?ref=feature',
      '.pipeline/custom.yml'
    ]

    piperExecResultMock = generatePiperGetDefaultsOutput(paths)

    await config.downloadDefaultConfig(
      'https://github.com',
      'https://api.github.com',
      'v1.0.0',
      'token',
      'org',
      'repo',
      paths.join(',')
    )

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.yaml'),
      expect.anything()
    )
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('?ref='),
      expect.anything()
    )
  })
})
