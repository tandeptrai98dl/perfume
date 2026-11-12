import { describe, expect, it } from 'vitest';

import { auditPageSchema } from './schemas';
import { csvCell, diffEntries, entityHref, maskIp, redactAuditValue, toCsv } from './view';

describe('redactAuditValue', () => {
  it('replaces contact fields and keeps their change shape', () => {
    expect(
      redactAuditValue({
        email: { from: 'a@b.vn', to: 'c@d.vn' },
        phone: '0912345678',
        status: { from: 'pending', to: 'confirmed' },
      }),
    ).toEqual({
      email: { from: '[redacted]', to: '[redacted]' },
      phone: '[redacted]',
      status: { from: 'pending', to: 'confirmed' },
    });
  });

  it('masks e-mail addresses and phone numbers inside free text, at any depth', () => {
    const value = redactAuditValue({
      reason: { from: null, to: 'Khách huong.nguyen@gmail.com gọi 0912 345 678 xin huỷ' },
      nested: { notes: ['call +84912345678'] },
      total: 3_200_000,
    }) as Record<string, unknown>;
    expect(JSON.stringify(value)).not.toMatch(/huong\.nguyen|345 678|84912345678/);
    expect((value.reason as { to: string }).to).toContain('h***@gmail.com');
    expect((value.reason as { to: string }).to).toContain('***678');
    expect(value.total).toBe(3_200_000);
  });

  it('leaves order codes, SKUs and amounts alone', () => {
    expect(redactAuditValue({ code: 'PF-261111-7K3Q', sku: 'CN-EDT-100' })).toEqual({
      code: 'PF-261111-7K3Q',
      sku: 'CN-EDT-100',
    });
  });
});

describe('maskIp', () => {
  it('truncates IPv4 and IPv6', () => {
    expect(maskIp('203.113.4.17')).toBe('203.113.4.*');
    expect(maskIp('2001:ee0:4f0a:1::5')).toBe('2001:ee0:4f0a:*');
    expect(maskIp(null)).toBeNull();
  });
});

describe('diffEntries', () => {
  it('separates field changes from plain values', () => {
    expect(diffEntries({ role: { from: 'staff', to: 'manager' }, sessionsRevoked: 2 })).toEqual([
      { field: 'role', kind: 'change', from: 'staff', to: 'manager' },
      { field: 'sessionsRevoked', kind: 'value', value: 2 },
    ]);
    expect(diffEntries(null)).toEqual([]);
  });
});

describe('entityHref', () => {
  it('links entities to their admin page', () => {
    expect(entityHref('order', 'abc')).toBe('/admin/orders/abc');
    expect(entityHref('staff', 'u1')).toBe('/admin/staff/u1');
    expect(entityHref('product_variant', 'v1')).toBe('/admin/inventory/movements?variant=v1');
    expect(entityHref('unknown', 'x')).toBeNull();
    expect(entityHref('order', null)).toBeNull();
  });
});

describe('CSV', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('');
  });

  it('starts with a BOM and uses CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });
});

describe('auditPageSchema', () => {
  it('treats empty params as no filter and rejects bad values', () => {
    const parsed = auditPageSchema.parse({ actorId: '', action: 'order.', dir: 'sideways' });
    expect(parsed.actorId).toBeNull();
    expect(parsed.action).toBe('order.');
    expect(parsed.dir).toBe('older');
    expect(auditPageSchema.safeParse({ action: "x' or 1=1" }).success).toBe(false);
    expect(auditPageSchema.safeParse({ from: '2026-13-45' }).success).toBe(false);
  });
});
