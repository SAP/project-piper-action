const core = require('@actions/core');
const tc = require('@actions/tool-cache');

async function run() {
  try {
    const piperPath = await tc.downloadTool('https://github.com/SAP/jenkins-library/releases/download/v1.12.0/piper');

    const command = core.getInput('command');
    console.log(`running piper ${piperPath} with command ${command}`)

  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
