const core = require('@actions/core');
const tc = require('@actions/tool-cache');
const exec = require('@actions/exec');
const fs = require('fs');

async function run() {
  try {
    const piperPath = await tc.downloadTool('https://github.com/SAP/jenkins-library/releases/download/v1.12.0/piper');
    fs.chmodSync(piperPath, 0o775)
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    await exec.exec(`${piperPath} ${command} ${flags}`);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
