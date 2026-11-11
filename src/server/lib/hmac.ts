import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 signatures for internal calls (worker → web). The signed message is
 * `${timestamp}.${body}` so a captured request cannot be replayed after `maxSkewMs`.
 */

export const SIGNATURE_HEADER = 'x-internal-signature';
export const TIMESTAMP_HEADER = 'x-internal-timestamp';
export const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signedHeaders(
  secret: string,
  body: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(now);
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `sha256=${sign(secret, timestamp, body)}`,
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

export function verify(
  secret: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
  { now = Date.now(), maxSkewMs = DEFAULT_MAX_SKEW_MS } = {},
): VerifyResult {
  if (!timestamp || !signature?.startsWith('sha256=')) return { ok: false, reason: 'missing' };
  const sentAt = Number(timestamp);
  if (!Number.isSafeInteger(sentAt) || Math.abs(now - sentAt) > maxSkewMs) {
    return { ok: false, reason: 'stale' };
  }
  const expected = Buffer.from(sign(secret, timestamp, body), 'hex');
  const received = Buffer.from(signature.slice('sha256='.length), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}
