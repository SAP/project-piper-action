import fs from 'fs'
import { debug, info } from '@actions/core'

export interface BuildTool {
  name: string
  dependencyFiles: string[]
  cachePath: string
  dockerMountPath: string

  detectTool: () => boolean
  getDependencyFiles: () => string[]
  extractDependencyContent: (filePath: string) => string
  getCacheEnvironmentVariables: (cacheRestored: boolean, dependenciesChanged: boolean) => Record<string, string>
  getDockerEnvironmentVariables: (cacheRestored: boolean, dependenciesChanged: boolean) => string[]
}

abstract class BaseBuildTool implements BuildTool {
  abstract name: string
  abstract dependencyFiles: string[]
  abstract cachePath: string
  abstract dockerMountPath: string

  detectTool (): boolean {
    return this.dependencyFiles.some(file => fs.existsSync(file))
  }

  getDependencyFiles (): string[] {
    return this.dependencyFiles.filter(file => fs.existsSync(file))
  }

  extractDependencyContent (filePath: string): string {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  }

  getCacheEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): Record<string, string> {
    return {
      PIPER_CACHE_RESTORED: cacheRestored ? 'true' : 'false',
      PIPER_DEPENDENCIES_CHANGED: dependenciesChanged ? 'true' : 'false'
    }
  }

  abstract getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[]
}

export class MavenBuildTool extends BaseBuildTool {
  name = 'maven'
  dependencyFiles = ['pom.xml']
  cachePath = '.m2'
  dockerMountPath = '/home/ubuntu/.m2'

  extractDependencyContent (filePath: string): string {
    if (!fs.existsSync(filePath)) return ''

    const content = fs.readFileSync(filePath, 'utf8')
    if (!filePath.endsWith('pom.xml')) {
      return content
    }
    const dependenciesMatch = content.match(/<dependencies>[\s\S]*?<\/dependencies>/g)
    if (dependenciesMatch !== null) {
      return dependenciesMatch.join('')
    }
    return content
  }

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    const mavenOpts = [
      '-Dmaven.artifact.threads=10',
      '-Xmx2g',
      '-Xms1g',
      '-XX:+UseG1GC',
      '-XX:+UseStringDeduplication',
      '-Dmvnd.enabled=true',
      '-Dmaven.compiler.useIncrementalCompilation=true',
      '-Dmaven.test.parallel=all',
      '-Dmaven.test.perCoreThreadCount=2',
      '-Dmaven.repo.local.recordReverseTree=true',
      '-Dmaven.javadoc.skip=true',
      '-Dmaven.source.skip=true',
      '-Dcyclonedx.skipAttach=false',
      '-Dcyclonedx.outputReactor=false',
      '-Dcyclonedx.verbose=false'
    ]

    if (cacheRestored && !dependenciesChanged) {
      mavenOpts.push(
        '-Dmaven.offline=true',
        '-Dmaven.snapshot.updatePolicy=never',
        '-Dmaven.release.updatePolicy=never'
      )
      info('Maven running in OFFLINE mode - using cached dependencies only')
    } else if (dependenciesChanged) {
      mavenOpts.push('-Dmaven.snapshot.updatePolicy=always')
      envVars.push('PIPER_MAVEN_FORCE_UPDATE=true')
      info('Dependencies changed - Maven will re-download and update cache')
    } else {
      info('Maven running in ONLINE mode - will download missing dependencies')
    }

    envVars.push(`MAVEN_OPTS=${mavenOpts.join(' ')}`)
    return envVars
  }

  getCacheEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): Record<string, string> {
    const baseVars = super.getCacheEnvironmentVariables(cacheRestored, dependenciesChanged)
    if (dependenciesChanged) {
      baseVars.PIPER_MAVEN_FORCE_UPDATE = 'true'
    }
    return baseVars
  }
}

export class NpmBuildTool extends BaseBuildTool {
  name = 'npm'
  dependencyFiles = ['package-lock.json', 'package.json']
  cachePath = '.npm'
  dockerMountPath = '/home/ubuntu/.npm'

  extractDependencyContent = extractDependencyContentNode

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    if (cacheRestored && !dependenciesChanged) {
      envVars.push('npm_config_prefer_offline=true')
      info('npm running with prefer-offline - using cached packages when available')
    } else if (dependenciesChanged) {
      envVars.push('npm_config_update_notifier=false')
      info('Dependencies changed - npm will re-download and update cache')
    }

    envVars.push('npm_config_cache=/home/ubuntu/.npm')
    return envVars
  }
}

export class PnpmBuildTool extends BaseBuildTool {
  name = 'pnpm'
  dependencyFiles = ['pnpm-lock.yaml', 'package.json']
  cachePath = '.pnpm-store'
  dockerMountPath = '/home/ubuntu/.pnpm-store'

  extractDependencyContent = extractDependencyContentNode

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    envVars.push('PNPM_HOME=/home/ubuntu/.pnpm-store')

    if (cacheRestored && !dependenciesChanged) {
      envVars.push('PNPM_OFFLINE=true')
      info('pnpm running in offline mode - using cached packages only')
    } else if (dependenciesChanged) {
      info('Dependencies changed - pnpm will re-download and update cache')
    }

    return envVars
  }
}

export class PipBuildTool extends BaseBuildTool {
  name = 'pip'
  dependencyFiles = ['requirements.txt', 'requirements-dev.txt', 'setup.py', 'pyproject.toml']
  cachePath = '.cache/pip'
  dockerMountPath = '/home/ubuntu/.cache/pip'

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    envVars.push('PIP_CACHE_DIR=/home/ubuntu/.cache/pip')

    if (cacheRestored && !dependenciesChanged) {
      envVars.push('PIP_NO_INDEX=true')
      envVars.push('PIP_FIND_LINKS=/home/ubuntu/.cache/pip')
      info('pip running in offline mode - using cached packages only')
    } else if (dependenciesChanged) {
      envVars.push('PIP_FORCE_REINSTALL=true')
      info('Dependencies changed - pip will re-download and update cache')
    }

    return envVars
  }
}

export class GradleBuildTool extends BaseBuildTool {
  name = 'gradle'
  dependencyFiles = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
  cachePath = '.gradle'
  dockerMountPath = '/home/ubuntu/.gradle'

  extractDependencyContent (filePath: string): string {
    if (!fs.existsSync(filePath)) return ''

    const content = fs.readFileSync(filePath, 'utf8')
    if (filePath.includes('build.gradle')) {
      const dependenciesMatch = content.match(/dependencies\s*{[\s\S]*?}/g)
      if (dependenciesMatch !== null) {
        return dependenciesMatch.join('')
      }
    }
    return content
  }

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    const gradleOpts = [
      '-Dorg.gradle.daemon=false',
      '-Dorg.gradle.parallel=true',
      '-Dorg.gradle.caching=true',
      '-Xmx2g',
      '-Xms1g'
    ]

    if (cacheRestored && !dependenciesChanged) {
      gradleOpts.push('--offline')
      info('Gradle running in offline mode - using cached dependencies only')
    } else if (dependenciesChanged) {
      gradleOpts.push('--refresh-dependencies')
      info('Dependencies changed - Gradle will re-download and update cache')
    }

    envVars.push(`GRADLE_OPTS=${gradleOpts.join(' ')}`)
    envVars.push('GRADLE_USER_HOME=/home/ubuntu/.gradle')
    return envVars
  }
}

export class GoBuildTool extends BaseBuildTool {
  name = 'go'
  dependencyFiles = ['go.mod', 'go.sum']
  cachePath = '.go'
  dockerMountPath = '/go'

  getDockerEnvironmentVariables (cacheRestored: boolean, dependenciesChanged: boolean): string[] {
    const envVars: string[] = []

    envVars.push('GOPATH=/go')
    envVars.push('GOCACHE=/go/build-cache')
    envVars.push('GOTMPDIR=/go/tmp')
    envVars.push('GOOS=linux')

    if (cacheRestored && !dependenciesChanged) {
      envVars.push('GOPROXY=off')
      info('Go running in offline mode - using cached modules only')
    } else if (dependenciesChanged) {
      envVars.push('GOPROXY=https://proxy.golang.org,direct')
      info('Dependencies changed - Go will re-download and update cache')
    }

    return envVars
  }
}

export class BuildToolManager {
  private readonly buildTools: BuildTool[] = [
    new MavenBuildTool(),
    new NpmBuildTool(),
    new PnpmBuildTool(),
    new PipBuildTool(),
    new GradleBuildTool(),
    new GoBuildTool()
  ]

  detectBuildTool (): BuildTool | null {
    for (const tool of this.buildTools) {
      if (tool.detectTool()) {
        debug(`Detected build tool: ${tool.name}`)
        return tool
      }
    }
    debug('No supported build tool detected')
    return null
  }

  detectBuildToolForStep (stepName: string): BuildTool | null {
    // Map step names to preferred build tools
    const stepToolMapping: Record<string, string> = {
      golangBuild: 'go',
      mavenBuild: 'maven',
      mavenExecute: 'maven',
      mavenExecuteIntegration: 'maven',
      mavenExecuteStaticCodeChecks: 'maven',
      npmExecuteScripts: 'npm',
      npmExecuteLint: 'npm',
      gradleBuild: 'gradle',
      gradleExecuteBuild: 'gradle',
      pythonBuild: 'pip',
      pipInstall: 'pip'
    }

    // Check if step has a preferred tool
    const preferredTool = stepToolMapping[stepName]
    if (preferredTool !== undefined) {
      const tool = this.getBuildToolByName(preferredTool)
      if (tool !== null && tool.detectTool()) {
        debug(`Using preferred build tool ${tool.name} for step ${stepName}`)
        return tool
      }
    }

    // Fall back to generic detection
    return this.detectBuildTool()
  }

  getBuildToolByName (name: string): BuildTool | null {
    return this.buildTools.find(tool => tool.name === name) ?? null
  }

  getAllDependencyFiles (): string[] {
    const allFiles: string[] = []
    for (const tool of this.buildTools) {
      allFiles.push(...tool.getDependencyFiles())
    }
    return [...new Set(allFiles)]
  }
}

function extractDependencyContentNode (filePath: string): string {
  if (!fs.existsSync(filePath)) return ''

  const content = fs.readFileSync(filePath, 'utf8')
  if (!filePath.endsWith('package.json')) { return content }
  try {
    const pkg = JSON.parse(content) as Record<string, any>
    return JSON.stringify({
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      peerDependencies: pkg.peerDependencies ?? {}
    })
  } catch {
    return content
  }
}
