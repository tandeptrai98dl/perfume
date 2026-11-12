import { describe, expect, it } from 'vitest';

import {
  ipInRanges,
  normalizeIp,
  parseIpAllowlist,
  parseIpRange,
  rateLimitIpKey,
  resolveClientIp,
} from './client-ip';

const headers = (values: Record<string, string>) => new Headers(values);

describe('resolveClientIp', () => {
  it('trusts nothing when TRUSTED_IP_HEADER is unset', () => {
    const list = headers({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' });
    expect(resolveClientIp(list, undefined)).toBeNull();
  });

  it('reads only the configured header', () => {
    const list = headers({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' });
    expect(resolveClientIp(list, 'cf-connecting-ip')).toBe('5.6.7.8');
    expect(resolveClientIp(headers({ 'x-forwarded-for': '1.2.3.4' }), 'cf-connecting-ip')).toBe(
      null,
    );
  });

  it('uses the right-most entry of an appended list (earlier ones are client-controlled)', () => {
    const list = headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 203.0.113.9' });
    expect(resolveClientIp(list, 'x-forwarded-for')).toBe('203.0.113.9');
  });

  it('rejects garbage and normalizes IPv6 forms', () => {
    expect(resolveClientIp(headers({ 'x-client-ip': 'not-an-ip' }), 'x-client-ip')).toBeNull();
    expect(resolveClientIp(headers({ 'x-client-ip': '::ffff:192.0.2.1' }), 'x-client-ip')).toBe(
      '192.0.2.1',
    );
    expect(resolveClientIp(headers({ 'x-client-ip': '[2001:DB8::1]' }), 'x-client-ip')).toBe(
      '2001:db8::1',
    );
  });
});

describe('normalizeIp', () => {
  it('drops IPv6 zone ids', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });
});

describe('rateLimitIpKey', () => {
  it('keeps IPv4 and collapses IPv6 to its /64', () => {
    expect(rateLimitIpKey('198.51.100.7')).toBe('198.51.100.7');
    expect(rateLimitIpKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpKey(null)).toBe('unknown');
  });
});

describe('IP allowlists', () => {
  it('parses single addresses and CIDR ranges', () => {
    expect(parseIpRange('203.0.113.5')).toEqual({ bytes: [203, 0, 113, 5], prefix: 32 });
    expect(parseIpRange('10.0.0.0/8')?.prefix).toBe(8);
    expect(parseIpRange('2001:db8::/32')?.prefix).toBe(32);
    expect(parseIpRange('10.0.0.0/33')).toBeNull();
    expect(parseIpRange('nope')).toBeNull();
  });

  it('throws on an invalid entry so a typo fails at boot', () => {
    expect(() => parseIpAllowlist('1.2.3.4, 1.2.3.999')).toThrow(/1\.2\.3\.999/);
    expect(parseIpAllowlist(undefined)).toEqual([]);
    expect(parseIpAllowlist('  ')).toEqual([]);
  });

  it('matches addresses against ranges of the same family', () => {
    const ranges = parseIpAllowlist('113.160.92.202, 10.1.0.0/16 2001:db8::/32');
    expect(ipInRanges('113.160.92.202', ranges)).toBe(true);
    expect(ipInRanges('113.160.92.203', ranges)).toBe(false);
    expect(ipInRanges('10.1.255.4', ranges)).toBe(true);
    expect(ipInRanges('10.2.0.1', ranges)).toBe(false);
    expect(ipInRanges('2001:db8:ffff::1', ranges)).toBe(true);
    expect(ipInRanges('2001:db9::1', ranges)).toBe(false);
    expect(ipInRanges('::ffff:10.1.2.3', ranges)).toBe(true);
    expect(ipInRanges(null, ranges)).toBe(false);
  });
});
