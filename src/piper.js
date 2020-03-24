const core = require('@actions/core')
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const glob = require('@actions/glob')
const fs = require('fs')

async function run () {
  try {
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    const piperPath = await tc.downloadTool(getDownloadUrl())
    fs.chmodSync(piperPath, 0o775)
    await exec.exec(`${piperPath} ${command} ${flags}`)
    showReports()
  } catch (error) {
    core.setFailed(error.message)
  }
}

function getDownloadUrl() {
  const version = core.getInput('piper-version')
  const commonUrlPrefix = 'https://github.com/SAP/jenkins-library/releases'
  if (version === 'latest') {
    console.log("Downloading latest release of piper")
    return `${commonUrlPrefix}/latest/download/piper`
  } else if (version === 'master') {
    console.log("Downloading latest build of master branch of piper")
    return `${commonUrlPrefix}/latest/download/piper_master`
  } else if (/^v\d+\./.test(version)) {
    console.log(`Downloading version ${version} of piper`)
    return `${commonUrlPrefix}/download/${version}/piper`
  } else {
    console.log(`WARN: ${version} was not recognized as valid piper version, downloading latest release`)
    return `${commonUrlPrefix}/latest/download/piper`
  }
}

function showReports() {
  const patterns = ['**/TEST*xml']
  const globber = glob.create(patterns.join('\n'))
  const files = globber.glob()
  files.forEach(reportFile => {
    console.log(reportFile)
  })
}

module.exports = run;
