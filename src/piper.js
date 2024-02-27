const core = require('@actions/core')
const exec = require('@actions/exec')
const utils = require('@sap/project-piper-action-utils')

async function run () {
  try {
    const enableBetaFeatures = process.env.USE_PIPER_ACTION_BETA_FEATURES === 'true'
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    const version = core.getInput('piper-version')
    const auth = core.getInput('github-token')
    // Download Piper
    const piperBin = 'piper'
    const downloader = new utils.GithubDownloaderBuilder('sap',
      'jenkins-library',
      piperBin,
      version)
      .githubEndpoint('https://github.com')
    if (auth) {
      downloader._auth = `Bearer ${auth}`
    }
    await downloader.download()

    const directoryRestore = new utils.DirectoryRestore('.pipeline/commonPipelineEnvironment')
    if (enableBetaFeatures) {
      await directoryRestore.load()
    }

    await exec.exec(`${piperBin} version`)
    await exec.exec(`${piperBin} ${command} ${flags}`)

    if (enableBetaFeatures) {
      utils.directoryToOutput('.pipeline/commonPipelineEnvironment')
      await directoryRestore.save()
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}
module.exports = run
