// Format for development versions (all parts required): 'devel:GH_OWNER:REPOSITORY:COMMITISH'
import fs from 'fs'
import { info } from '@actions/core'
import { downloadTool, extractZip } from '@actions/tool-cache'
import { chdir, cwd } from 'process'
import { join } from 'path'
import { exec } from '@actions/exec'
import { GITHUB_COM_SERVER_URL } from './github'

export async function buildPiperFromSource (version: string): Promise<string> {
  const { owner, repository, commitISH } = parseDevelVersion(version)
  const versionName = (() => {
    if (!/^[0-9a-f]{7,40}$/.test(commitISH)) {
      throw new Error('Can\'t resolve COMMITISH, use SHA or short SHA')
    }
    return commitISH.slice(0, 7)
  })()
  const path = `${process.cwd()}/${owner}-${repository}-${versionName}`
  const piperPath = `${path}/piper`
  if (fs.existsSync(piperPath)) {
    return piperPath
  }
  // TODO
  // check if cache is available
  info(`Building Piper from ${version}`)
  const url = `${GITHUB_COM_SERVER_URL}/${owner}/${repository}/archive/${commitISH}.zip`
  info(`URL: ${url}`)
  await extractZip(
    await downloadTool(url, `${path}/source-code.zip`), `${path}`)
  const wd = cwd()

  const repositoryPath = join(path, fs.readdirSync(path).find((name: string) => {
    return name.includes(repository)
  }) ?? '')
  chdir(repositoryPath)

  const cgoEnabled = process.env.CGO_ENABLED
  process.env.CGO_ENABLED = '0'
  await exec(
    'go build -o ../piper',
    [
      '-ldflags',
      `-X github.com/SAP/jenkins-library/cmd.GitCommit=${commitISH}
      -X github.com/SAP/jenkins-library/pkg/log.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}
      -X github.com/SAP/jenkins-library/pkg/telemetry.LibraryRepository=${GITHUB_COM_SERVER_URL}/${owner}/${repository}`
    ]
  )
  process.env.CGO_ENABLED = cgoEnabled
  chdir(wd)
  fs.rmSync(repositoryPath, { recursive: true, force: true })
  // TODO
  // await download cache
  return piperPath
}

export function parseDevelVersion (version: string): { env: string, owner: string, repository: string, commitISH: string } {
  const versionComponents = version.split(':')
  if (versionComponents.length !== 4 || versionComponents[0] !== 'devel') {
    throw new Error('broken version')
  }
  const [env, owner, repository, commitISH] = versionComponents
  return { env, owner, repository, commitISH }
}
