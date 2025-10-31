// tokenize functions splits a string of CLI flags by whitespace, additionally handling double-quoted
// and space separated string values
import { debug, info, warning } from '@actions/core'
import path from 'path'
import { existsSync, lstatSync, readdirSync, symlinkSync, unlinkSync, statSync } from 'fs'
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

  // Create .git symlink
  try {
    const gitSymlinkPath = path.join(subdirPath, '.git')
    const parentGitPath = path.join(repoRoot, '.git')

    // Check if .git already exists in subdirectory
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
      // Create symlink using relative path for Docker compatibility
      info(`Creating .git symlink: ${subdirPath}/.git -> ../.git`)
      symlinkSync(path.join('..', '.git'), gitSymlinkPath, 'dir')
      internalActionVariables.gitSymlinkCreated = true
      debug('.git symlink created successfully')
    }
  } catch (error) {
    warning(`Failed to create .git symlink: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Create .pipeline symlinks (selective merge approach)
  try {
    const pipelineSymlinkPath = path.join(subdirPath, '.pipeline')
    const parentPipelinePath = path.join(repoRoot, '.pipeline')

    // Check if .pipeline already exists in subdirectory
    if (existsSync(pipelineSymlinkPath)) {
      const stats = lstatSync(pipelineSymlinkPath)
      if (stats.isSymbolicLink()) {
        info('.pipeline symlink already exists')
      } else {
        // Service-specific .pipeline directory exists
        info('.pipeline directory exists in subdirectory - creating selective symlinks for missing items')

        // Selectively symlink items that don't exist in subdirectory
        if (existsSync(parentPipelinePath)) {
          createSelectivePipelineSymlinks(pipelineSymlinkPath, parentPipelinePath)
        }
      }
    } else if (!existsSync(parentPipelinePath)) {
      info(`Parent .pipeline directory not found at ${parentPipelinePath} - will be created later`)
    } else {
      // No .pipeline in subdirectory, symlink the whole directory
      info(`Creating .pipeline symlink: ${subdirPath}/.pipeline -> ../.pipeline`)
      symlinkSync(path.join('..', '.pipeline'), pipelineSymlinkPath, 'dir')
      internalActionVariables.pipelineSymlinkCreated = true
      debug('.pipeline symlink created successfully')
    }
  } catch (error) {
    warning(`Failed to create .pipeline symlink: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Creates selective symlinks for .pipeline subdirectories and files that don't exist
 * in the service's .pipeline directory but exist in the parent.
 *
 * This enables a "merge" behavior where service-specific files (like config.yml) are used,
 * but shared files (like commonPipelineEnvironment) are symlinked from parent.
 *
 * @param subdirPipelinePath - Path to subdirectory's .pipeline (e.g., /repo/backend/.pipeline)
 * @param parentPipelinePath - Path to parent's .pipeline (e.g., /repo/.pipeline)
 */
function createSelectivePipelineSymlinks (subdirPipelinePath: string, parentPipelinePath: string): void {
  try {
    const parentItems = readdirSync(parentPipelinePath)

    for (const item of parentItems) {
      // Skip certain items that should always be service-specific
      if (item === 'config.yml' || item === 'defaults_temp') {
        continue
      }

      const subdirItemPath = path.join(subdirPipelinePath, item)
      const parentItemPath = path.join(parentPipelinePath, item)

      // Only create symlink if item doesn't exist in subdirectory
      if (!existsSync(subdirItemPath)) {
        try {
          const stats = statSync(parentItemPath)
          const symlinkType = stats.isDirectory() ? 'dir' : 'file'

          // Use relative path for Docker compatibility
          const relativePath = path.join('..', '..', '.pipeline', item)

          info(`Creating selective symlink: .pipeline/${item} -> ${relativePath}`)
          symlinkSync(relativePath, subdirItemPath, symlinkType)

          // Track that we created pipeline symlinks (for cleanup)
          internalActionVariables.pipelineSymlinkCreated = true
        } catch (err) {
          debug(`Skipping symlink for ${item}: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        debug(`.pipeline/${item} already exists in subdirectory, keeping local version`)
      }
    }
  } catch (error) {
    debug(`Could not read parent .pipeline directory: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Ensures .pipeline symlinks are created after loadPipelineEnv() has run.
 * This is necessary because loadPipelineEnv() may create the parent .pipeline directory
 * via writePipelineEnv, but setupMonorepoSymlinks() only creates symlinks if the parent
 * already exists. This function is called AFTER chdir to working directory.
 *
 * @param workingDir - The working directory from action configuration (e.g., 'backend')
 */
function ensurePipelineSymlinksAfterLoad (workingDir: string): void {
  const isSubdirectory = workingDir !== '.' && workingDir !== ''
  if (!isSubdirectory) {
    return
  }

  // We've already changed to the working directory, so use originalCwd to get repo root
  const repoRoot = internalActionVariables.originalCwd
  if (repoRoot.length === 0) {
    debug('Original working directory not set, cannot ensure pipeline symlinks')
    return
  }

  const subdirPath = path.join(repoRoot, workingDir)
  const pipelineSymlinkPath = path.join(subdirPath, '.pipeline')
  const parentPipelinePath = path.join(repoRoot, '.pipeline')

  try {
    // Check if parent .pipeline now exists (may have been created by writePipelineEnv)
    if (!existsSync(parentPipelinePath)) {
      debug('Parent .pipeline still does not exist, no symlinks needed')
      return
    }

    // Check current state of subdirectory's .pipeline
    if (existsSync(pipelineSymlinkPath)) {
      const stats = lstatSync(pipelineSymlinkPath)
      if (stats.isSymbolicLink()) {
        debug('.pipeline symlink already exists')
      } else {
        // Service-specific .pipeline directory exists
        // Create selective symlinks for items that don't exist in subdirectory
        info('Creating selective symlinks for .pipeline items from parent')
        createSelectivePipelineSymlinks(pipelineSymlinkPath, parentPipelinePath)
      }
    } else {
      // No .pipeline in subdirectory, symlink the whole directory
      info(`Creating .pipeline symlink: ${subdirPath}/.pipeline -> ../.pipeline`)
      symlinkSync(path.join('..', '.pipeline'), pipelineSymlinkPath, 'dir')
      internalActionVariables.pipelineSymlinkCreated = true
      debug('.pipeline symlink created successfully')
    }
  } catch (error) {
    warning(`Failed to ensure .pipeline symlink: ${error instanceof Error ? error.message : String(error)}`)
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

  // Remove .pipeline symlinks (both whole directory and selective symlinks)
  if (internalActionVariables.pipelineSymlinkCreated) {
    try {
      const pipelineSymlinkPath = path.join(subdirPath, '.pipeline')

      if (existsSync(pipelineSymlinkPath)) {
        const stats = lstatSync(pipelineSymlinkPath)

        if (stats.isSymbolicLink()) {
          // Whole .pipeline directory was symlinked
          info(`Removing .pipeline symlink: ${pipelineSymlinkPath}`)
          unlinkSync(pipelineSymlinkPath)
          debug('.pipeline symlink removed successfully')
        } else if (stats.isDirectory()) {
          // Selective symlinks were created inside .pipeline directory
          info('Removing selective .pipeline symlinks')
          const items = readdirSync(pipelineSymlinkPath)

          for (const item of items) {
            try {
              const itemPath = path.join(pipelineSymlinkPath, item)
              const itemStats = lstatSync(itemPath)

              if (itemStats.isSymbolicLink()) {
                debug(`Removing symlink: .pipeline/${item}`)
                unlinkSync(itemPath)
              }
            } catch (err) {
              debug(`Could not remove .pipeline/${item}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        }
      }

      internalActionVariables.pipelineSymlinkCreated = false
    } catch (error) {
      warning(`Failed to remove .pipeline symlinks: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export {
  tokenize, changeToWorkingDirectory, restoreOriginalDirectory, setupMonorepoSymlinks, ensurePipelineSymlinksAfterLoad, cleanupMonorepoSymlinks
}
