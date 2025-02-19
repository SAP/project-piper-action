import { debug, info } from '@actions/core'

export async function wait (delay: number): Promise<string> {
  return await new Promise((resolve) => setTimeout(resolve, delay))
}

export async function fetchRetry (url: string, method = 'GET', tries = 5, baseDelayMS = 1000): Promise<Response> {
  let attempt = 0

  // Validate url
  let validatedUrl: URL
  try {
    validatedUrl = new URL(url)
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`)
  }
  while (tries > attempt) {
    try {
      const response = await fetch(validatedUrl, { method })
      if (response.status === 200) {
        return response
      }

      info(`Error while fetching ${url}: Status: ${response.statusText}\nCode: ${response.status}`)
      if (!isRetryable(response.status)) {
        debug(`Non-retryable status code: ${response.status}`)
        break
      }

      attempt += 1
    } catch (error) {
      if (error instanceof TypeError) {
        debug(`TypeError while fetching ${url}: ${error.message}, params: ${JSON.stringify({ url, method })}`)
        info(`TypeError while fetching ${url}: ${error.message}`)
      } else {
        debug(`Error (non TypeError while fetching ${url}: ${(error as Error).message}`)
        throw error
      }
    }

    if (tries > attempt) {
      const delayTime = baseDelayMS * Math.pow(2, attempt - 1)
      info(`Retrying ${tries - attempt} more time(s)...`)
      info(`Waiting ${delayTime} ms`)
      await wait(delayTime)
    }
  }
  throw new Error(`Error fetching ${url}`)
}

function isRetryable (code: number): boolean {
  switch (code) {
    case 408: // Request Timeout
      return true
    case 404:
      return false
    default:
      return code >= 500 && code !== 501 // Retry for server errors except 501 (Not Implemented)
  }
}
