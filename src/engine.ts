import { type ExecOptions, type ExecOutput, getExecOutput } from '@actions/exec'
import { chmodSync, existsSync } from 'fs'

// V2 steps list - steps that should use engine instead of piper
export const v2StepsList = new Set<string>([
  'mavenBuild',
  'detectExecuteScan',
  'sonarExecuteScan',
  'sampleItem'
])

export function isV2Step (stepName: string): boolean {
  return v2StepsList.has(stepName)
}

export async function executeEngine (
  binaryPath: string,
  stepName: string,
  flags: string[]
): Promise<ExecOutput> {
  // Validate binary exists
  if (!existsSync(binaryPath)) {
    throw new Error(`Engine binary not found at path: ${binaryPath}`)
  }

  // Ensure executable
  chmodSync(binaryPath, 0o775)

  // Execute: engine <stepName> <flags>
  const args: string[] = [stepName, ...flags]

  // Set up environment with GitHub token for catalogue access
  const env: { [key: string]: string } = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  // Set GITHUB_TOKEN for catalogue access if not already set
  if (process.env.PIPER_ACTION_GITHUB_ENTERPRISE_TOKEN !== undefined && env.GITHUB_TOKEN === undefined) {
    env.GITHUB_TOKEN = process.env.PIPER_ACTION_GITHUB_ENTERPRISE_TOKEN
  }

  const options: ExecOptions = {
    ignoreReturnCode: true,
    env
  }

  return await getExecOutput(binaryPath, args, options)
}
