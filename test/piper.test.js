jest.mock('@actions/core');
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const core = require('@actions/core');
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

const run = require('../src/piper.js');

describe('Piper', () => {
  beforeEach(() => {
    tc.downloadTool
      .mockReturnValue('./piper')
    core.getInput.mockImplementation(key => {
      switch (key) {
        case 'command':
          return 'version'
        case 'flags':
          return '--noTelemetry'
        default:
          return ''
      }
    })
    fs.chmodSync = jest.fn()
  })
  afterEach(() => {
    tc.downloadTool.mockReset()
    core.getInput.mockReset()
    fs.chmodSync.mockReset()
  })

  test('default', async () => {
    await run();

    expect(fs.chmodSync).toHaveBeenCalledWith('./piper', 0o775);
    expect(exec.exec).toHaveBeenCalledWith('./piper version --noTelemetry');
    expect(core.setFailed).not.toHaveBeenCalled()
  });
});
