import * as core from '@actions/core'
import { info } from '@actions/core'
import { fetchRetry } from '../src/fetch'

jest.mock('@actions/core')

describe('Fetch package tests', () => {
  const testURL = 'https://github.com/SAP/jenkins-library/releases/tag/v1.1.1'
  const tries = 3
  const delay = 0
  const mockResponse500 = {
    status: 500,
    statusText: 'Internal Server Error'
  } as unknown as Response
  const mockResponse404 = {
    status: 404,
    statusText: 'Not Found'
  } as unknown as Response
  const mockResponse200 = {
    status: 200,
    statusText: 'OK'
  } as unknown as Response

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  test('fetchRetry - 200 OK', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return mockResponse200
    })

    await fetchRetry(testURL, undefined, tries, delay)
    expect(core.info).toHaveBeenCalledTimes(0)
  })

  test('fetchRetry - retry on 500 status and eventually succeed', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return mockResponse500
    })
    jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return mockResponse200
    })

    await fetchRetry(testURL, undefined, tries, delay)

    expect(info).toHaveBeenCalledWith(`Error while fetching ${testURL}: Status: Internal Server Error\nCode: 500`)
    expect(info).toHaveBeenCalledWith('Retrying 2 more time(s)...')
    expect(info).not.toHaveBeenCalledWith('Retrying 1 more time(s)...')
  })

  test('fetchRetry - No retry on 404 status', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return mockResponse404
    })

    await expect(fetchRetry(testURL, undefined, tries, delay)).rejects.toThrow(`Error fetching ${testURL}`)

    expect(info).toHaveBeenCalledWith(`Error while fetching ${testURL}: Status: ${mockResponse404.statusText}\nCode: ${mockResponse404.status}`)
  })

  test('fetchRetry - error after max retries', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return mockResponse500
    })

    await expect(fetchRetry(testURL, undefined, tries, delay)).rejects.toThrow(`Error fetching ${testURL}`)

    expect(info).toHaveBeenCalledWith(`Error while fetching ${testURL}: Status: Internal Server Error\nCode: 500`)
    expect(info).toHaveBeenCalledWith('Retrying 2 more time(s)...')
    expect(info).toHaveBeenCalledWith('Retrying 1 more time(s)...')
  })
})
