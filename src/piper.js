const core = require('@actions/core')
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

async function run () {
  try {
    const piperPath = await tc.downloadTool(getDownloadUrl())
    fs.chmodSync(piperPath, 0o775)
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    await exec.exec(`${piperPath} ${command} ${flags}`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

function getDownloadUrl() {
  const version = core.getInput('version')
  if (version === 'release') {
    console.log("Downloading latest release of piper")
    return 'https://github.com/SAP/jenkins-library/releases/latest/download/piper'
  } else if (version === 'master') {
    console.log("Downloading latest build of master branch of piper")
    return 'https://github.com/SAP/jenkins-library/releases/latest/download/piper_master'
  } else if (/^v\d+\./.test(version)) {
    console.log(`Downloading version ${version} of piper`)
    return `https://github.com/SAP/jenkins-library/releases/download/${version}/piper`
  } else {
    console.log(`WARN: ${version} was not recognized as valid piper version, downloading latest release`)
    return 'https://github.com/SAP/jenkins-library/releases/latest/download/piper'
  }
}

module.exports = run;
