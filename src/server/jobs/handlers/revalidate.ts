import { signedHeaders } from '@/server/lib/hmac';

import type { JobPayload } from '../definitions';

/**
 * Next.js caches live in the web process, so the worker asks the web app to revalidate
 * through the HMAC-signed internal endpoint.
 */
export function createRevalidateHandler(options: {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
}) {
  const doFetch = options.fetch ?? fetch;
  return async (payload: JobPayload<'cache.revalidate'>) => {
    const body = JSON.stringify(payload);
    const response = await doFetch(new URL('/api/internal/revalidate', options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedHeaders(options.secret, body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    // Non-2xx throws so pg-boss retries with backoff.
    if (!response.ok) throw new Error(`Revalidate failed with HTTP ${response.status}`);
  };
}
