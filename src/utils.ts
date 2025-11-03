// tokenize functions splits a string of CLI flags by whitespace, additionally handling double-quoted
// and space separated string values
import { debug, info, warning } from '@actions/core'
import path from 'path'
import { existsSync, lstatSync, readdirSync, symlinkSync, unlinkSync } from 'fs'
import { internalActionVariables } from './piper'

function tokenize (input: string): string[] {
  // This regular expression looks for:
  // 1. Sequences inside double quotes which may contain spaces (captured including the quotes)
  // 2. Or sequences of non-space characters
  const regex = /"[^"]*"|\S+/g

  const matches = input.match(regex)
  if (matches == null) {
    return []
  }

  return matches.map(arg => {
    // Preserve the double quotes around arguments
    if (arg.startsWith('"') && arg.endsWith('"')) {
      return arg
    }

    return arg
  })
}

/**
 * Changes the Node.js process working directory to the specified subdirectory.
 * This makes all relative paths work naturally from the subdirectory.
 *
 * @param workingDir - The working directory from action configuration (e.g., 'backend')
 */
function changeToWorkingDirectory (workingDir: string): void {
  // Only change directory if running from a subdirectory
  const isSubdirectory = workingDir !== '.' && workingDir !== ''

  if (!isSubdirectory) {
    debug('Running from root directory, no directory change needed')
    internalActionVariables.originalCwd = process.cwd()
    return
  }

  try {
    const originalCwd = process.cwd()
    const targetDir = path.join(originalCwd, workingDir)

    internalActionVariables.originalCwd = originalCwd

    info(`Changing directory from ${originalCwd} to ${targetDir}`)

    // Verify target directory exists
    if (!existsSync(targetDir)) {
      throw new Error(`Working directory does not exist: ${targetDir}`)
    }

    // Change Node.js working directory
    process.chdir(targetDir)

    info(`Successfully changed to working directory: ${process.cwd()}`)
    debug(`Original directory stored: ${originalCwd}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to change to working directory '${workingDir}': ${errorMsg}`)
  }
}

/**
 * Restores the original working directory.
 * Called in the finally block to ensure cleanup.
 */
function restoreOriginalDirectory (): void {
  if (internalActionVariables.originalCwd === '' || internalActionVariables.originalCwd === process.cwd()) {
    return
  }

  try {
    info(`Restoring original directory: ${internalActionVariables.originalCwd}`)
    process.chdir(internalActionVariables.originalCwd)
    debug('Directory restored successfully')
  } catch (error) {
    warning(`Failed to restore original directory: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Creates symbolic links for .git and .pipeline directories when running from a subdirectory.
 * This enables piper steps to access the git repository and pipeline configuration.
 *
 * IMPORTANT: Must be called BEFORE changeToWorkingDirectory() so symlinks are created
 * from the repository root.
 *
 * @param workingDir - The working directory from action configuration (e.g., 'backend')
 */
function setupMonorepoSymlinks (workingDir: string): void {
  // Only create symlinks if running from a subdirectory
  const isSubdirectory = workingDir !== '.' && workingDir !== ''

  if (!isSubdirectory) {
    debug('Running from root directory, no symlinks needed')
    return
  }

  const repoRoot = process.cwd()
  const subdirPath = path.join(repoRoot, workingDir)

  debug(`Repository root: ${repoRoot}`)
  debug(`Subdirectory path: ${subdirPath}`)

  const gitSymlinkPath = path.join(subdirPath, '.git')
  const parentGitPath = path.join(repoRoot, '.git')
  try {
    if (existsSync(gitSymlinkPath)) {
      const stats = lstatSync(gitSymlinkPath)
      if (stats.isSymbolicLink()) {
        debug('.git symlink already exists')
      } else {
        debug('.git directory already exists (not a symlink)')
      }
    } else if (!existsSync(parentGitPath)) {
      warning(`Parent .git directory not found at ${parentGitPath}`)
    } else {
      // Determine if parent .git is a file or directory
      const symlinkType: 'dir' | 'file' = lstatSync(parentGitPath).isDirectory() ? 'dir' : 'file'
      // Use relative path for symlink target
      const relativeParentGitPath = path.relative(subdirPath, parentGitPath)
      info(`Creating .git symlink: ${subdirPath}/.git -> ${relativeParentGitPath}`)
      symlinkSync(relativeParentGitPath, gitSymlinkPath, symlinkType)
      internalActionVariables.gitSymlinkCreated = true
      debug('.git symlink created successfully')
    }
  } catch (error) {
    warning(`Failed to create .git symlink: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Removes the symlinks created by setupMonorepoSymlinks().
 * Called in the finally block to ensure cleanup even if the action fails.
 * Must be called AFTER restoreOriginalDirectory() to access the symlinks.
 */
function cleanupMonorepoSymlinks (): void {
  const workingDir = internalActionVariables.workingDir
  const originalCwd = internalActionVariables.originalCwd

  if (workingDir === '.' || workingDir === '') {
    return
  }

  const repoRoot = originalCwd !== '' ? originalCwd : process.cwd()
  const subdirPath = path.join(repoRoot, workingDir)

  // Remove .git symlink
  if (internalActionVariables.gitSymlinkCreated) {
    try {
      const gitSymlinkPath = path.join(subdirPath, '.git')
      if (existsSync(gitSymlinkPath)) {
        const stats = lstatSync(gitSymlinkPath)
        if (stats.isSymbolicLink()) {
          info(`Removing .git symlink: ${gitSymlinkPath}`)
          unlinkSync(gitSymlinkPath)
          debug('.git symlink removed successfully')
        }
      }
      internalActionVariables.gitSymlinkCreated = false
    } catch (error) {
      warning(`Failed to remove .git symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export {
  tokenize, changeToWorkingDirectory, restoreOriginalDirectory, setupMonorepoSymlinks, cleanupMonorepoSymlinks
}
