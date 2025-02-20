import { getTag } from '../src/github'
import { debug } from '@actions/core'

jest.mock('../src/fetch')
jest.mock('@actions/core')

describe('getTag', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return "latest" for empty version', () => {
    const result = getTag('', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "latest" for "master" version', () => {
    const result = getTag('master', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "latest" for "latest" version', () => {
    const result = getTag('latest', true)
    expect(result).toBe('latest')
    expect(debug).toHaveBeenCalledWith('Using latest tag')
  })

  it('should return "tags/version" for a specific version when forAPICall is true', () => {
    const result = getTag('v1.0.0', true)
    expect(result).toBe('tags/v1.0.0')
    expect(debug).toHaveBeenCalledWith('getTag returns: tags/v1.0.0')
  })

  it('should return "tag/version" for a specific version when forAPICall is false', () => {
    const result = getTag('v1.0.0', false)
    expect(result).toBe('tag/v1.0.0')
    expect(debug).toHaveBeenCalledWith('getTag returns: tag/v1.0.0')
  })
})
