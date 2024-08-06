export function isRetryable (code: number): boolean {
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
