const core = require('@actions/core')
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const fs = require('fs')

async function run () {
  try {
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    const version = core.getInput('piper-version')
    let piperPath
    // Format for development versions (all parts required): 'devel:GH_ORG:REPO_NAME:COMMITISH
    if (/^devel:/.test(version)) {
      piperPath = await buildDevelopmentBranch(version)
    } else {
      piperPath = await tc.downloadTool(getDownloadUrl(version))
    }
    fs.chmodSync(piperPath, 0o775)
    await exec.exec(`${piperPath} version`)
    await exec.exec(`${piperPath} ${command} ${flags}`)
    core.setOutput('binary', piperPath)
  } catch (error) {
    core.setFailed(error.message)
  }
}

function getDownloadUrl(version) {
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

async function buildDevelopmentBranch(version) {
  console.log("Building a dev version of piper from " + version)
  const versionComponents = version.split(":")
  const githubOrg = versionComponents[1]
  const repo = versionComponents[2]
  const commitish = versionComponents[3]

  const zip = await tc.downloadTool(`https://github.com/${githubOrg}/${repo}/archive/${commitish}.zip`)
  const unzippedPath = await tc.extractZip(zip)
  const oldWorkingDir = process.cwd()
  const checkedOutSourcesPath = `${unzippedPath}/${repo}-${commitish.replace(/\//g, '-')}`
  process.chdir(checkedOutSourcesPath)
  process.env.CGO_ENABLED = '0'
  await exec.exec(`go build -ldflags "-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitish} -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=https://github.com/${githubOrg}/${repo} -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=https://github.com/${githubOrg}/${repo}" -o piper`)
  process.chdir(oldWorkingDir)
  return `${checkedOutSourcesPath}/piper`
}

module.exports = run;
