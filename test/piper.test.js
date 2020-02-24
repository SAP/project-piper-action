jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const core = require('@actions/core');
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

const run = require('../src/piper.js');

describe('Piper', () => {
  let inputs

  beforeEach(() => {
    inputs = {};

    fs.chmodSync = jest.fn()
    tc.downloadTool.mockReturnValue('./piper')
    jest.spyOn(core, 'setFailed')
    jest.spyOn(core, 'getInput').mockImplementation((name, options) => {
      let val = inputs[name]
      if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return val.trim();
    });
  })
  afterEach(() => {
    jest.resetAllMocks();
    jest.clearAllMocks();
  })

  test('default', async () => {
    inputs['command'] = 'version'
    inputs['flags'] = '--noTelemetry'
    inputs['piper-version'] = 'v1.10.0'

    await run();

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(tc.downloadTool).toHaveBeenCalledWith('https://github.com/SAP/jenkins-library/releases/download/v1.10.0/piper')
    expect(fs.chmodSync).toHaveBeenCalledWith('./piper', 0o775);
    expect(exec.exec).toHaveBeenCalledWith('./piper version --noTelemetry');
  });
});
