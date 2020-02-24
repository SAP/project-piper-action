jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const core = require('@actions/core');
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

const run = require('../src/piper.js');

describe('Piper', () => {
  let inputs
  let inputSpy

  beforeEach(() => {
    inputs = {};

    inputSpy = jest.spyOn(core, 'getInput');
    failedSpy = jest.spyOn(core, 'setFailed');
    fs.chmodSync = jest.fn()

    tc.downloadTool.mockReturnValue('./piper')
    inputSpy.mockImplementation((name, options) => {
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

    await run();

    expect(failedSpy).not.toHaveBeenCalled()
    expect(fs.chmodSync).toHaveBeenCalledWith('./piper', 0o775);
    expect(exec.exec).toHaveBeenCalledWith('./piper version --noTelemetry');
  });
});
