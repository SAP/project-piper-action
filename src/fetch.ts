import { info } from '@actions/core'

export async function wait (delay: number): Promise<string> {
  return await new Promise((resolve) => setTimeout(resolve, delay))
}

export async function fetchRetry (url: string, tries: number): Promise<Response> {
  while (tries > 0) {
    const response = await fetch(url)
    if (response.status === 200) {
      return response
    }

    info(`Error while fetching ${url}: ${response.statusText}`)
    tries -= 1
    if (!isRetryable(response.status)) {
      break
    }

    info(`Retrying ${tries} more time(s)...`)
    if (tries > 0) {
      await wait(1000)
    }
  }
  return await Promise.reject(new Error(`Error fetching ${url}`))
}

function isRetryable (code: number): boolean {
  // server error
  if (code >= 500 && code !== 501) {
    return true
  }

  // too many requests or timeouts are retryable too
  if (code === 429 || code === 408) {
    return true
  }

  return false
}
