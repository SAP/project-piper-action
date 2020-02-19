jest.mock('@actions/core');
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const core = require('@actions/core');
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

const run = require('../src/piper.js');

/* eslint-disable no-undef */
describe('Piper', () => {
  beforeEach(() => {
    tc.downloadTool
      .mockReturnValue('./piper')
    core.getInput
      .mockReturnValueOnce('version')
      .mockReturnValueOnce('--noTelemetry')

      fs.chmodSync = jest.fn()
  })
  afterEach(() => {
  })

  test('', async () => {

    await run();

    expect(fs.chmodSync).toHaveBeenCalledWith('./piper', 0o775);
    expect(exec.exec).toHaveBeenCalledWith('./piper version --noTelemetry');
  });
});
