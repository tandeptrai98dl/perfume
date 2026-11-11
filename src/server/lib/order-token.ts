import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Guest access token for an order page (email links `?t=…`). Pure and secret-injected so the
 * worker can build the same links as the web app without Next.js APIs (ADR-0023). The web
 * wrapper with cookies lives in `src/server/order-access.ts`.
 */
export function computeOrderAccessToken(secret: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`order-access:${code}`)
    .digest('base64url')
    .slice(0, 32);
}

export function verifyOrderAccessTokenWith(
  secret: string,
  code: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(computeOrderAccessToken(secret, code));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
