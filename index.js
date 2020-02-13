const core = require('@actions/core');
const tc = require('@actions/tool-cache');
const exec = require('@actions/exec');
const fs = require('fs');

async function run() {
  try {
    const piperPath = await tc.downloadTool('https://github.com/SAP/jenkins-library/releases/download/v1.12.0/piper');
    fs.chmod(piperPath, 0o775, (err) => {
      if (err) throw err;
      console.log('Piper is executable');
    })
    const command = core.getInput('command');
    console.log(`running piper ${piperPath} with command ${command}`)

    await exec.exec(`${piperPath} ${command}`);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
