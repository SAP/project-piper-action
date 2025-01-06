// src/build.test.ts
import { parseDevelVersion } from '../src/build'

describe('parseDevelVersion', () => {
  it('should parse a valid version string', () => {
    const version = 'devel:GH_OWNER:REPOSITORY:COMMITISH'
    const { env, owner, repository, commitISH } = parseDevelVersion(version)
    expect(env).toBe('devel')
    expect(owner).toBe('GH_OWNER')
    expect(repository).toBe('REPOSITORY')
    expect(commitISH).toBe('COMMITISH')
  })

  it('should throw an error for an invalid version string', () => {
    const version = 'invalid:version:string'
    expect(() => parseDevelVersion(version)).toThrow('broken version')
  })
})
