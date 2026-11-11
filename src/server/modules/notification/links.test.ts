import { describe, expect, it } from 'vitest';

import { computeOrderAccessToken } from '@/server/lib/order-token';

import { carrierTrackingUrl, orderPageUrl } from './links';
import { emailForTransition } from './service';

describe('order e-mail links', () => {
  it('links to the localized order page with the access token', () => {
    const vi = orderPageUrl({
      appUrl: 'https://shop.vn',
      locale: 'vi',
      code: 'PF-1',
      secret: 's'.repeat(32),
    });
    expect(vi).toBe(
      `https://shop.vn/tra-cuu-don-hang?code=PF-1&t=${computeOrderAccessToken('s'.repeat(32), 'PF-1')}`,
    );
    const en = orderPageUrl({ appUrl: 'https://shop.vn/', locale: 'en', code: 'PF-1' });
    expect(en).toBe('https://shop.vn/en/order-lookup?code=PF-1');
  });

  it('builds tracking links only for carriers with a public page', () => {
    expect(carrierTrackingUrl('ghn', 'AB 1')).toBe('https://donhang.ghn.vn/?order_code=AB%201');
    expect(carrierTrackingUrl('ghtk', 'S1')).toBe('https://i.ghtk.vn/S1');
    expect(carrierTrackingUrl('self', 'X')).toBeNull();
  });

  it('maps status changes to customer e-mails', () => {
    expect(emailForTransition('processing', 'shipped')).toBe('shipped');
    expect(emailForTransition('shipped', 'delivered')).toBe('delivered');
    expect(emailForTransition('return_requested', 'delivered')).toBeNull();
    expect(emailForTransition('pending', 'cancelled')).toBe('cancelled');
    expect(emailForTransition('delivery_failed', 'returned')).toBe('refunded');
    expect(emailForTransition('confirmed', 'processing')).toBeNull();
  });
});
