import { info } from '@actions/core'

export async function wait (delay: number): Promise<string> {
  return await new Promise((resolve) => setTimeout(resolve, delay))
}

export async function fetchRetry (url: string, tries = 5, baseDelayMS = 1000): Promise<Response> {
  let attempt = 0

  while (tries > 0) {
    const response = await fetch(url)
    if (response.status === 200) {
      return response
    }

    info(`Error while fetching ${url}: ${response.statusText}`)
    if (!isRetryable(response.status)) {
      break
    }

    attempt += 1
    tries -= 1

    if (tries > 0) {
      const delayTime = baseDelayMS * Math.pow(2, attempt - 1)
      info(`Retrying ${tries} more time(s)...`)
      info(`Waiting ${delayTime} ms`)
      await wait(delayTime)
    }
  }
  return await Promise.reject(new Error(`Error fetching ${url}`))
}

function isRetryable (code: number): boolean {
  switch (code) {
    case 408: // Request Timeout
    case 429: // Too Many Requests
      return true
    default:
      return code >= 500 && code !== 501 // Retry for server errors except 501 (Not Implemented)
  }
}
