import { describe, expect, it } from 'vitest';

import {
  canSeeCustomerContact,
  customerKeyString,
  displayContact,
  lifetimeSpend,
  parseCustomerKey,
  parseCustomerSearch,
  prefixPattern,
} from './admin-rules';
import { customerFilterSchema, customerListSchema, setCodRiskFlagSchema } from './admin-schemas';

const ID = '0190f6b6-0000-7000-8000-000000000001';

describe('customer keys', () => {
  it('parses account ids and guest keys, rejects anything else', () => {
    expect(parseCustomerKey(ID)).toEqual({ type: 'user', id: ID });
    expect(parseCustomerKey(`g-${ID}`)).toEqual({ type: 'guest', orderId: ID });
    expect(parseCustomerKey('g-123')).toBeNull();
    expect(parseCustomerKey('../orders')).toBeNull();
  });

  it('round-trips', () => {
    for (const key of [`g-${ID}`, ID]) {
      expect(customerKeyString(parseCustomerKey(key)!)).toBe(key);
    }
  });
});

describe('parseCustomerSearch', () => {
  it('detects e-mails (exact or prefix), lower-cased', () => {
    expect(parseCustomerSearch(' Huong@Example.com ')).toEqual({
      kind: 'email',
      value: 'huong@example.com',
    });
    expect(parseCustomerSearch('huong@')).toEqual({ kind: 'email', value: 'huong@' });
  });

  it('normalizes phone numbers and phone prefixes to national digits', () => {
    expect(parseCustomerSearch('+84 912 345 678')).toEqual({ kind: 'phone', value: '0912345678' });
    expect(parseCustomerSearch('0912.345')).toEqual({ kind: 'phone', value: '0912345' });
    expect(parseCustomerSearch('+84912')).toEqual({ kind: 'phone', value: '0912' });
  });

  it('treats everything else as a name; blank is no search', () => {
    expect(parseCustomerSearch('Hương')).toEqual({ kind: 'name', value: 'Hương' });
    expect(parseCustomerSearch('09')).toEqual({ kind: 'name', value: '09' });
    expect(parseCustomerSearch('   ')).toBeNull();
  });

  it('escapes LIKE wildcards in prefixes', () => {
    expect(prefixPattern('a%b_c\\')).toBe('a\\%b\\_c\\\\%');
  });
});

describe('contact masking', () => {
  it('follows customers.viewContactInOrder', () => {
    expect(canSeeCustomerContact('owner')).toBe(true);
    expect(canSeeCustomerContact('manager')).toBe(true);
    expect(canSeeCustomerContact('staff')).toBe(true);
    expect(canSeeCustomerContact('editor')).toBe(false);
    expect(canSeeCustomerContact('customer')).toBe(false);
  });

  it('masks phone and e-mail partially', () => {
    const contact = { phone: '0912345678', email: 'huong@example.com' };
    expect(displayContact(contact, true)).toEqual({ ...contact, masked: false });
    expect(displayContact(contact, false)).toEqual({
      phone: '091****678',
      email: 'h***@example.com',
      masked: true,
    });
    expect(displayContact({ phone: '', email: null }, false)).toEqual({
      phone: null,
      email: null,
      masked: true,
    });
  });
});

describe('lifetimeSpend', () => {
  it('sums confirmed orders net of refunds, in whole VND', () => {
    expect(
      lifetimeSpend([
        { status: 'completed', total: 3_200_000, amountRefunded: 200_000 },
        { status: 'delivered', total: 1_500_000, amountRefunded: 0 },
        { status: 'cancelled', total: 9_000_000, amountRefunded: 9_000_000 },
        { status: 'pending', total: 700_000, amountRefunded: 0 },
        { status: 'delivery_failed', total: 2_000_000, amountRefunded: 0 },
        { status: 'returned', total: 1_000_000, amountRefunded: 1_000_000 },
      ]),
    ).toBe(4_500_000);
  });
});

describe('schemas', () => {
  it('falls back to defaults for hand-edited URLs', () => {
    expect(customerListSchema.parse({ sort: 'evil', dir: 'x', page: '-3', pageSize: '7' })).toEqual(
      {
        q: '',
        type: undefined,
        risk: undefined,
        sort: 'lastOrder',
        dir: 'desc',
        page: 1,
        pageSize: 20,
      },
    );
    expect(customerFilterSchema.parse({ type: '', risk: 'flagged', q: ' an ' })).toMatchObject({
      type: undefined,
      risk: 'flagged',
      q: 'an',
    });
  });

  it('requires a reason for risk changes', () => {
    expect(
      setCodRiskFlagSchema.safeParse({ userId: ID, flagged: true, reason: ' ab ' }).success,
    ).toBe(false);
    expect(
      setCodRiskFlagSchema.safeParse({ userId: ID, flagged: true, reason: 'Bom hàng 2 lần' })
        .success,
    ).toBe(true);
  });
});
