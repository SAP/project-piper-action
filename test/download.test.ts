// import { getPiperDownloadURL } from '../src/download'
// import { fetchRetry } from '../src/fetch'
import { getTag } from '../src/github'
import { debug } from '@actions/core'

jest.mock('../src/fetch')

// describe('getPiperDownloadURL', () => {
//   const piper = 'piper'
//   const version = '1.0.0'
//   const tag = 'v1.0.0'
//   const tagURL = `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/releases/${tag}`
//   const downloadURL = `${GITHUB_COM_SERVER_URL}/SAP/jenkins-library/download/${tag}/${piper}`
//
//   beforeEach(() => {
//     jest.clearAllMocks()
//   })
//
//   it('should return the correct download URL', async () => {
//     (fetchRetry as jest.Mock).mockResolvedValue({
//       url: tagURL
//     })
//
//     const result = await getPiperDownloadURL(piper, version)
//     expect(result).toBe(downloadURL)
//     expect(fetchRetry).toHaveBeenCalledWith(tagURL, 'HEAD')
//   })
//
//   it('should throw an error if fetchRetry fails', async () => {
//     const errorMessage: string = 'Network error';
//     (fetchRetry as jest.Mock).mockRejectedValue(new Error(errorMessage))
//
//     await expect(getPiperDownloadURL(piper, version)).rejects.toThrow(`Can't get the tag: ${errorMessage}`)
//     expect(fetchRetry).toHaveBeenCalledWith(tagURL, 'HEAD')
//   })
// })

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
