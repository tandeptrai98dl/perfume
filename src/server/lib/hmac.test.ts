import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_SKEW_MS,
  signedHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verify,
} from './hmac';

const SECRET = 's'.repeat(32);
const BODY = JSON.stringify({ tags: ['product:1'] });
const NOW = 1_800_000_000_000;

describe('internal HMAC', () => {
  const headers = signedHeaders(SECRET, BODY, NOW);
  const ts = headers[TIMESTAMP_HEADER]!;
  const sig = headers[SIGNATURE_HEADER]!;

  it('accepts a fresh, correctly signed body', () => {
    expect(verify(SECRET, BODY, ts, sig, { now: NOW + 1000 })).toEqual({ ok: true });
  });

  it('rejects a tampered body or a different secret', () => {
    expect(verify(SECRET, BODY.replace('1', '2'), ts, sig, { now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verify('x'.repeat(32), BODY, ts, sig, { now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects replays outside the time window', () => {
    expect(verify(SECRET, BODY, ts, sig, { now: NOW + DEFAULT_MAX_SKEW_MS + 1 })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('rejects missing or malformed headers', () => {
    expect(verify(SECRET, BODY, null, sig, { now: NOW })).toEqual({ ok: false, reason: 'missing' });
    expect(verify(SECRET, BODY, ts, 'md5=abc', { now: NOW })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verify(SECRET, BODY, ts, 'sha256=zz', { now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verify(SECRET, BODY, 'abc', sig, { now: NOW })).toEqual({ ok: false, reason: 'stale' });
  });
});
