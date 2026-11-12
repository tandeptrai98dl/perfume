import { describe, expect, it } from 'vitest';

import { createWebhookAllowlists, isWebhookSourceAllowed } from './webhook-allowlist';

describe('payment webhook IP allowlist', () => {
  it('is off by default: every source is accepted', () => {
    const lists = createWebhookAllowlists({});
    expect(lists).toEqual({});
    expect(isWebhookSourceAllowed(lists, 'vnpay', '198.51.100.1')).toBe(true);
    expect(isWebhookSourceAllowed(lists, 'payos', null)).toBe(true);
  });

  it('accepts only listed sources for a configured provider', () => {
    const lists = createWebhookAllowlists({
      VNPAY_IPN_ALLOWED_IPS: '113.160.92.202, 203.171.19.0/24',
    });
    expect(isWebhookSourceAllowed(lists, 'vnpay', '113.160.92.202')).toBe(true);
    expect(isWebhookSourceAllowed(lists, 'vnpay', '203.171.19.146')).toBe(true);
    expect(isWebhookSourceAllowed(lists, 'vnpay', '203.171.20.1')).toBe(false);
    // Unknown source (no trusted IP header) is refused once a list exists.
    expect(isWebhookSourceAllowed(lists, 'vnpay', null)).toBe(false);
    // payOS has no list: unaffected.
    expect(isWebhookSourceAllowed(lists, 'payos', '203.171.20.1')).toBe(true);
  });

  it('throws on an invalid entry', () => {
    expect(() => createWebhookAllowlists({ PAYOS_WEBHOOK_ALLOWED_IPS: '1.2.3' })).toThrow();
  });
});
