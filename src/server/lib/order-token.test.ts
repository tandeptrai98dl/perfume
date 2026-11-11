import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeOrderAccessToken, verifyOrderAccessTokenWith } from './order-token';

const SECRET = 'unit-test-secret-unit-test-secret-0000';

describe('order access token', () => {
  it('matches the HMAC the web app has always used for email links', () => {
    const legacy = createHmac('sha256', SECRET)
      .update('order-access:PF-261111-7K3Q')
      .digest('base64url')
      .slice(0, 32);
    expect(computeOrderAccessToken(SECRET, 'PF-261111-7K3Q')).toBe(legacy);
  });

  it('verifies only the token of the same order and secret', () => {
    const token = computeOrderAccessToken(SECRET, 'PF-1');
    expect(verifyOrderAccessTokenWith(SECRET, 'PF-1', token)).toBe(true);
    expect(verifyOrderAccessTokenWith(SECRET, 'PF-2', token)).toBe(false);
    expect(verifyOrderAccessTokenWith(`${SECRET}x`, 'PF-1', token)).toBe(false);
    expect(verifyOrderAccessTokenWith(SECRET, 'PF-1', null)).toBe(false);
    expect(verifyOrderAccessTokenWith(SECRET, 'PF-1', 'short')).toBe(false);
  });
});
