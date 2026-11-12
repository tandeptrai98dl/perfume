import { describe, expect, it } from 'vitest';

import { consumeRateLimit, RATE_LIMITS, rateLimitKey } from './rate-limit';

describe('rateLimitKey', () => {
  it('hashes the subject so raw IPs and e-mails are never stored', () => {
    const key = rateLimitKey('orderLookup', '203.0.113.9');
    expect(key.startsWith('orderLookup:')).toBe(true);
    expect(key).not.toContain('203.0.113.9');
    expect(key).toHaveLength('orderLookup:'.length + 32);
    expect(rateLimitKey('orderLookup', '203.0.113.9')).toBe(key);
    expect(rateLimitKey('placeOrder', '203.0.113.9')).not.toBe(key);
  });
});

describe('RATE_LIMITS', () => {
  it('matches §12', () => {
    expect(RATE_LIMITS.placeOrder).toEqual({ limit: 5, windowMs: 60_000 });
    expect(RATE_LIMITS.orderLookup).toEqual({ limit: 5, windowMs: 600_000 });
    expect(RATE_LIMITS.couponAttempt).toEqual({ limit: 10, windowMs: 60_000 });
  });
});

describe('consumeRateLimit', () => {
  const db = {} as never;

  it('refuses unknown scopes without a rule and windows over 24 h', async () => {
    await expect(consumeRateLimit(db, { scope: 'nope', subject: 'x' })).rejects.toThrow(/nope/);
    await expect(
      consumeRateLimit(db, {
        scope: 'custom',
        subject: 'x',
        rule: { limit: 1, windowMs: 25 * 60 * 60 * 1000 },
      }),
    ).rejects.toThrow(/24 h/);
  });
});
