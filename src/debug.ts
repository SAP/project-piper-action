import { startGroup, endGroup, debug, info } from '@actions/core'
import path from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { internalActionVariables } from './piper'

export function debugDirectoryStructure (prefix: string): void {
  startGroup(`=== ${prefix}: directory structure ===`)
  info(`Current working directory: ${process.cwd()}`)
  info(`Original working directory: ${internalActionVariables.originalCwd}`)

  info('\n.pipeline directory:')
  const pipelineDir = path.join(process.cwd(), '.pipeline')
  if (existsSync(pipelineDir)) {
    printDirectoryTree(pipelineDir, '', 2, 0)
  } else {
    info('  (does not exist)')
  }

  info('\n.pipeline/commonPipelineEnvironment files:')
  const cpeDir = path.join(process.cwd(), '.pipeline', 'commonPipelineEnvironment')
  if (existsSync(cpeDir)) {
    printDirectoryTree(cpeDir, '', 3, 0)
  } else {
    info('  (does not exist)')
  }

  endGroup()
}

// Debug logging functions
function printDirectoryTree (dirPath: string, prefix: string = '', maxDepth: number = 2, currentDepth: number = 0): void {
  if (currentDepth >= maxDepth) return

  try {
    const items = readdirSync(dirPath)
    items.forEach((item, index) => {
      const itemPath = path.join(dirPath, item)
      const isLast = index === items.length - 1
      const connector = isLast ? '└── ' : '├── '

      try {
        const stats = statSync(itemPath)
        const itemType = stats.isDirectory() ? '📁' : '📄'
        info(`${prefix}${connector}${itemType} ${item}`)

        if (stats.isDirectory() && !item.startsWith('.git') && item !== 'node_modules') {
          const newPrefix = prefix + (isLast ? '    ' : '│   ')
          printDirectoryTree(itemPath, newPrefix, maxDepth, currentDepth + 1)
        }
      } catch (err) {
        debug(`Cannot access ${itemPath}`)
      }
    })
  } catch (error) {
    debug(`Cannot read directory ${dirPath}`)
  }
}
