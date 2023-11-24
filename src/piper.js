const core = require('@actions/core')
const exec = require('@actions/exec')
const utils = require('@sap/project-piper-action-utils')

async function run () {
  try {
    // styling output: https://www.npmjs.com/package/@actions/core
    core.warning('\u001b[38;2;255;255;0mThis action will be deprecated soon, please use the open-source Piper action: \u001b[5;48;2;210;210;210;38;2;0;0;0muses: SAP/piper-github-action@main\u001b[0m (https://github.com/SAP/project-piper-action/tree/main)')

    const enableBetaFeatures = process.env.USE_PIPER_ACTION_BETA_FEATURES === 'true'
    const command = core.getInput('command')
    const flags = core.getInput('flags')
    const version = core.getInput('piper-version')

    // Download Piper
    const piperBin = 'piper'
    await new utils.GithubDownloaderBuilder('sap',
      'jenkins-library',
      piperBin,
      version)
      .githubEndpoint('https://github.com')
      .download()

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
