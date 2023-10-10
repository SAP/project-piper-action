import { dirname } from 'path'
import { info } from '@actions/core'
import { exec } from '@actions/exec'
import { v4 as uuidv4 } from 'uuid'

export async function startContainer (dockerImage: string, dockerOptions: string, config: any):
Promise<string | undefined> {
  dockerImage = dockerImage !== '' ? dockerImage : config.dockerImage
  if (dockerImage === undefined || dockerImage === '') {
    return undefined
  }

  const piperPath = process.env.piperPath
  if (piperPath === undefined) {
    throw new Error('Can\'t get context config: piperPath not defined!')
  }

  const containerID = uuidv4()
  const cwd = process.cwd()
  info(`Starting image ${dockerImage} as container ${containerID}`)

  let dockerOutput = ''
  // let dockerError = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        dockerOutput += data.toString()
      },
      stderr: (data: Buffer) => {
        // dockerError += data.toString()
      }
    }
  }

  dockerOptions = dockerOptions !== '' ? dockerOptions : config.dockerOptions

  let dockerOptionsArray: string[] = []
  if (dockerOptions !== undefined && Array.isArray(dockerOptions)) {
    dockerOptionsArray = dockerOptions.map(option => option.split(' ')).flat()
  } else if (dockerOptions !== undefined) {
    dockerOptionsArray = dockerOptions.split(' ')
  }

  await exec('docker', [
    'run',
    '--tty',
    '--detach',
    '--rm',
    '--user', '1000:1000',
    '--volume', `${cwd}:${cwd}`,
    '--volume', `${dirname(piperPath)}:/piper`,
    '--workdir', cwd,
    ...dockerOptionsArray,
    '--name', containerID,
    ...getOrchestratorEnvVars(),
    ...getVaultEnvVars(),
    dockerImage,
    'cat'
  ], options)
  return dockerOutput.trim()
}

/** expose env vars needed for Piper orchestrator package (https://github.com/SAP/jenkins-library/blob/master/pkg/orchestrator/gitHubActions.go) */
function getOrchestratorEnvVars (): string[] {
  return [
    // needed for Piper orchestrator detection
    '--env',
    'GITHUB_ACTION',
    '--env',
    'GITHUB_ACTIONS',
    // Build Info
    '--env',
    'GITHUB_JOB',
    '--env',
    'GITHUB_RUN_ID',
    '--env',
    'GITHUB_REF',
    '--env',
    'GITHUB_SERVER_URL',
    '--env',
    'GITHUB_API_URL',
    '--env',
    'GITHUB_REPOSITORY',
    '--env',
    'GITHUB_SHA',
    // Pull Request Info (needed for sonarExecuteScan)
    '--env',
    'GITHUB_HEAD_REF',
    '--env',
    'GITHUB_BASE_REF',
    '--env',
    'GITHUB_EVENT_PULL_REQUEST_NUMBER',
    '--env',
    'PIPER_ACTION_GITHUB_ENTERPRISE_TOKEN'
  ]
}

function getVaultEnvVars (): string[] {
  return [
    '--env',
    'PIPER_vaultAppRoleID',
    '--env',
    'PIPER_vaultAppRoleSecretID'
  ]
}
