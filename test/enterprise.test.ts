import { ENTERPRISE_DEFAULTS_FILENAME, ENTERPRISE_STAGE_CONFIG_FILENAME, getEnterpriseDefaultsUrl, getEnterpriseStageConfigUrl, isEnterpriseStep, onGitHubEnterprise } from '../src/enterprise'
import { GITHUB_COM_SERVER_URL } from '../src/github'

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
  describe('', () => {
    const envClone = Object.assign({}, process.env)

    afterEach(() => {
      process.env = Object.assign({}, envClone)
    })
    describe('getEnterpriseDefaultsUrl', () => {
      test('with env var set', async () => {
        // init
        process.env.GITHUB_SERVER_URL = GITHUB_COM_SERVER_URL
        // test
        // assert
        expect(getEnterpriseDefaultsUrl('anything', 'something')).toBe('')
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
          expect(getEnterpriseDefaultsUrl(owner, repository)).toBe(`${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_DEFAULTS_FILENAME}`)
        })

        test('with no repository', async () => {
          // init
          const owner = 'anything'
          const repository = ''
          // test
          // assert
          expect(getEnterpriseDefaultsUrl(owner, repository)).toBe('')
        })
      })
    })
    describe('getEnterpriseStageConfigUrl', () => {
      test('with env var set', async () => {
        // init
        process.env.GITHUB_SERVER_URL = GITHUB_COM_SERVER_URL
        // test
        // assert
        expect(getEnterpriseStageConfigUrl('anything', 'something')).toBe('')
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
          expect(getEnterpriseStageConfigUrl(owner, repository)).toBe(`${process.env.GITHUB_API_URL}/repos/${owner}/${repository}/contents/resources/${ENTERPRISE_STAGE_CONFIG_FILENAME}`)
        })

        test('with no repository', async () => {
          // init
          const owner = 'anything'
          const repository = ''
          // test
          // assert
          expect(getEnterpriseStageConfigUrl(owner, repository)).toBe('')
        })
      })
    })
  })
})
