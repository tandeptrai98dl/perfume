import { describe, expect, it } from 'vitest';

import { scrubAttributes } from './sentry-options';
import { REDACTED, scrubEvent, scrubText, scrubUrl, scrubValue } from './scrub';

describe('scrubText', () => {
  it('masks emails and Vietnamese phone numbers', () => {
    expect(scrubText('Order for khach.hang@example.com, phone 0912 345 678')).toBe(
      'Order for [email], phone [phone]',
    );
    expect(scrubText('+84912345678 and 84-912-345-678')).toBe('[phone] and [phone]');
  });

  it('leaves order codes, prices and ids alone', () => {
    expect(scrubText('Order PS-2611-0042 total 3200000 id 01a1cac1-669a-795f')).toBe(
      'Order PS-2611-0042 total 3200000 id 01a1cac1-669a-795f',
    );
  });
});

describe('scrubValue', () => {
  it('drops sensitive keys and scrubs nested strings', () => {
    expect(
      scrubValue({
        password: 'x',
        nested: { phone: '0912345678', note: 'mail a@b.vn' },
        list: ['0912345678'],
      }),
    ).toEqual({
      password: REDACTED,
      nested: { phone: REDACTED, note: 'mail [email]' },
      list: ['[phone]'],
    });
  });

  it('survives cycles', () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    expect(scrubValue(value)).toEqual({ a: 1, self: REDACTED });
  });
});

describe('scrubEvent', () => {
  it('removes request PII and keeps only the user id', () => {
    const event = scrubEvent({
      message: 'Failed for a@b.vn',
      user: { id: 'u1', email: 'a@b.vn', ip_address: '1.2.3.4' },
      request: {
        url: 'https://shop.vn/reset-password?token=abc&email=a@b.vn',
        cookies: { session: 'x' },
        data: { phone: '0912345678' },
        headers: { cookie: 'x', authorization: 'Bearer y', 'user-agent': 'UA' },
      },
      exception: { values: [{ value: 'Duplicate key a@b.vn' }] },
    });
    expect(event.message).toBe('Failed for [email]');
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.request).toEqual({
      url: `https://shop.vn/reset-password?token=${REDACTED}&email=${REDACTED}`,
      headers: { 'user-agent': 'UA' },
    });
    expect(event.exception?.values?.[0]?.value).toBe('Duplicate key [email]');
  });

  it('scrubs URLs without a query string', () => {
    expect(scrubUrl('https://shop.vn/a@b.vn')).toBe('https://shop.vn/[email]');
  });
});

describe('scrubAttributes', () => {
  it('drops query values from URL attributes', () => {
    expect(
      scrubAttributes({
        'url.full': 'https://shop.vn/order-lookup?code=PS1&phone=0912345678',
        'http.request.header.cookie': 'a=b',
        'db.statement': 'select * from users where email = a@b.vn',
      }),
    ).toEqual({
      'url.full': `https://shop.vn/order-lookup?code=${REDACTED}&phone=${REDACTED}`,
      'http.request.header.cookie': REDACTED,
      'db.statement': 'select * from users where email = [email]',
    });
  });
});
