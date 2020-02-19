jest.mock('@actions/core');
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')
//jest.mock('fs')

const core = require('@actions/core');
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
//const fs = require('fs')

const run = require('../src/piper.js');

/* eslint-disable no-undef */
describe('Piper', () => {
  beforeEach(() => {})
  afterEach(() => {})

  test('', async () => {
    tc.downloadTool = jest
      .fn()
      .mockReturnValueOnce('myToolInLocalDirectory')
    core.getInput = jest
      .fn()
      .mockReturnValueOnce('command')
      .mockReturnValueOnce('flags')
      
//    fs.chmodSync = jest.fn()
    exec.exec = jest.fn()

    await run();

    expect(exec.exec).toHaveBeenCalledWith('myToolInLocalDirectory command flags');
  });
});
