import {
  ENTERPRISE_STAGE_CONFIG_FILENAME,
  DEFAULT_CONFIG,
  STAGE_CONFIG,
  getEnterpriseConfigUrl,
  isEnterpriseStep,
  onGitHubEnterprise,
  parsePrereleaseVersion
} from '../src/enterprise'
import { GITHUB_COM_SERVER_URL } from '../src/github'
import * as github from '../src/github'

describe('test enterprise.ts', () => {
  describe('isEnterpriseStep', () => {
    it.each([
      ['', false],
      ['version', false],
      ['mavenBuild', false],
      ['sapInternalStep', true]
    ])('expects result for %p to be %p', (stepName: string, state: boolean) => {
      expect(isEnterpriseStep(stepName)).toBe(state)
    })
  })

  describe('onGitHubEnterprise', () => {
    const envClone = Object.assign({}, process.env)

    afterEach(() => {
      process.env = Object.assign({}, envClone)
    })

    test('with env var set', async () => {
      // init
      process.env.GITHUB_SERVER_URL = GITHUB_COM_SERVER_URL
      // test
      // assert
      expect(onGitHubEnterprise()).toBeFalsy()
    })

    test('with env var not set', async () => {
      // init
      process.env.GITHUB_SERVER_URL = ''
      // test
      // assert
      expect(onGitHubEnterprise()).toBeTruthy()
    })
  })

  describe('getEnterpriseConfigUrl', () => {
    test('wrong config type', async () => {
      const result = getEnterpriseConfigUrl('configType', 'apiURL', 'version', 'token', 'anything', 'something')
      await expect(result).resolves.toEqual('')
    })

    describe('with enterprise github', () => {
      process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
      process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'
      test.skip('with owner & repository', async () => {
        // init
        const owner = 'anything'
        const repository = 'something'
        // test
        // assert
        expect(getEnterpriseConfigUrl(DEFAULT_CONFIG, 'apiURL', 'version', 'token', owner, repository)).toBe(`${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_STAGE_CONFIG_FILENAME}`)
      })

      test.skip('with no repository', async () => {
        // init
        const owner = 'anything'
        const repository = ''
        // test
        // assert
        expect(getEnterpriseConfigUrl(STAGE_CONFIG, 'apiURL', 'version', 'token', owner, repository)).toBe('')
      })
    })

    describe('with prerelease version', () => {
      const envClone = Object.assign({}, process.env)

      beforeEach(() => {
        jest.spyOn(github, 'getReleaseAssetUrl').mockResolvedValue(['http://mock.test/asset/piper-defaults.yml', 'v1.0.0'])
      })

      afterEach(() => {
        jest.restoreAllMocks()
        process.env = Object.assign({}, envClone)
      })

      test('parses prerelease:OWNER:REPO:TAG format correctly', async () => {
        process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

        const version = 'prerelease:custom-owner:custom-repo:v1.2.3'
        await getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://api.github.com', version, 'token', 'default-owner', 'default-repo')

        // Should call getReleaseAssetUrl with parsed owner, repo, and tag
        expect(github.getReleaseAssetUrl).toHaveBeenCalledWith(
          expect.any(String),
          'v1.2.3',
          'https://api.github.com',
          'token',
          'custom-owner',
          'custom-repo'
        )
      })

      test('uses PIPER_ENTERPRISE_SERVER_URL when set', async () => {
        process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.enterprise.example.com'
        process.env.GITHUB_API_URL = 'https://github.enterprise.example.com/api/v3'

        const version = 'prerelease:test-owner:test-repo:v1.0.0'
        await getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://original-api.com', version, 'token', 'default-owner', 'default-repo')

        // Should use the enterprise server URL for the API
        expect(github.getReleaseAssetUrl).toHaveBeenCalledWith(
          expect.any(String),
          'v1.0.0',
          'https://github.enterprise.example.com/api/v3',
          'token',
          'test-owner',
          'test-repo'
        )
      })

      test('uses PIPER_ACTION_WDF_GITHUB_ENTERPRISE_TOKEN when set', async () => {
        process.env.PIPER_ACTION_WDF_GITHUB_ENTERPRISE_TOKEN = 'enterprise-token'
        process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

        const version = 'prerelease:owner:repo:tag'
        await getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://api.test.com', version, 'original-token', 'default-owner', 'default-repo')

        // Should use the enterprise token instead of original token
        expect(github.getReleaseAssetUrl).toHaveBeenCalledWith(
          expect.any(String),
          'tag',
          'https://api.test.com',
          'enterprise-token',
          'owner',
          'repo'
        )
      })

      test('throws error when tag is missing', async () => {
        process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

        const version = 'prerelease:owner:repo:'
        await expect(
          getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://api.test.com', version, 'token', 'default-owner', 'default-repo')
        ).rejects.toThrow("Invalid prerelease version format: 'prerelease:owner:repo:'. Expected format: 'prerelease:OWNER:REPO:TAG'")
      })

      test('throws error when owner/repo are missing', async () => {
        process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

        const version = 'prerelease:::'
        await expect(
          getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://api.test.com', version, 'token', 'fallback-owner', 'fallback-repo')
        ).rejects.toThrow("Invalid prerelease version format: 'prerelease:::'. Expected format: 'prerelease:OWNER:REPO:TAG'")
      })

      test('throws error when format is incomplete', async () => {
        process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'

        const version = 'prerelease:owner'
        await expect(
          getEnterpriseConfigUrl(DEFAULT_CONFIG, 'https://api.test.com', version, 'token', 'default-owner', 'default-repo')
        ).rejects.toThrow("Invalid prerelease version format: 'prerelease:owner'. Expected format: 'prerelease:OWNER:REPO:TAG'")
      })

      test('combines enterprise server URL and token when both are set', async () => {
        process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.enterprise.example.com'
        process.env.PIPER_ACTION_WDF_GITHUB_ENTERPRISE_TOKEN = 'enterprise-combined-token'
        process.env.GITHUB_API_URL = 'https://github.enterprise.example.com/api/v3'

        const version = 'prerelease:prerelease-owner:prerelease-repo:v2.0.0'
        await getEnterpriseConfigUrl(STAGE_CONFIG, 'https://original-api.com', version, 'original-token', 'default-owner', 'default-repo')

        expect(github.getReleaseAssetUrl).toHaveBeenCalledWith(
          ENTERPRISE_STAGE_CONFIG_FILENAME,
          'v2.0.0',
          'https://github.enterprise.example.com/api/v3',
          'enterprise-combined-token',
          'prerelease-owner',
          'prerelease-repo'
        )
      })
    })
  })

  describe('parsePrereleaseVersion', () => {
    const envClone = Object.assign({}, process.env)

    afterEach(() => {
      process.env = Object.assign({}, envClone)
    })

    test('parses valid prerelease version correctly', () => {
      const result = parsePrereleaseVersion(
        'prerelease:my-owner:my-repo:v1.0.0',
        'https://default-api.com',
        'https://default-server.com',
        'default-token'
      )

      expect(result.owner).toBe('my-owner')
      expect(result.repository).toBe('my-repo')
      expect(result.version).toBe('v1.0.0')
      expect(result.apiURL).toBe('https://default-api.com')
      expect(result.server).toBe('https://default-server.com')
      expect(result.token).toBe('default-token')
    })

    test('applies enterprise server URL override', () => {
      process.env.PIPER_ENTERPRISE_SERVER_URL = 'https://github.enterprise.example.com'

      const result = parsePrereleaseVersion(
        'prerelease:owner:repo:tag',
        'https://default-api.com',
        'https://default-server.com',
        'default-token'
      )

      expect(result.apiURL).toBe('https://github.enterprise.example.com/api/v3')
      expect(result.server).toBe('https://github.enterprise.example.com')
    })

    test('applies enterprise token override', () => {
      process.env.PIPER_ACTION_WDF_GITHUB_ENTERPRISE_TOKEN = 'enterprise-token'

      const result = parsePrereleaseVersion(
        'prerelease:owner:repo:tag',
        'https://default-api.com',
        'https://default-server.com',
        'default-token'
      )

      expect(result.token).toBe('enterprise-token')
    })

    test('throws error for missing parts', () => {
      expect(() => parsePrereleaseVersion(
        'prerelease:owner:repo:',
        'https://default-api.com',
        'https://default-server.com',
        'default-token'
      )).toThrow("Invalid prerelease version format: 'prerelease:owner:repo:'. Expected format: 'prerelease:OWNER:REPO:TAG'")
    })

    test('throws error for insufficient parts', () => {
      expect(() => parsePrereleaseVersion(
        'prerelease:owner',
        'https://default-api.com',
        'https://default-server.com',
        'default-token'
      )).toThrow("Invalid prerelease version format: 'prerelease:owner'. Expected format: 'prerelease:OWNER:REPO:TAG'")
    })
  })
})
