/**
 * `fetch` that aborts when no response has arrived after `milliseconds`, so a stalled connection
 * (mobile handover, captive portal, half-open TCP) cannot keep a request pending forever. The
 * caller sees a rejected fetch, exactly like a network error. Client-safe: no server import.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  milliseconds: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
