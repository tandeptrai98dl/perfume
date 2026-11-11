import { describe, expect, it } from 'vitest';

import { safeInternalPath } from './safe-redirect';

const FALLBACK = '/tai-khoan';

describe('safeInternalPath', () => {
  it.each([
    ['/tai-khoan/don-hang', '/tai-khoan/don-hang'],
    ['/en/account/orders?page=2#top', '/en/account/orders?page=2#top'],
    ['/san-pham/x?v=SKU-1', '/san-pham/x?v=SKU-1'],
    // Encoded characters stay encoded: still a path on this site.
    ['/%0a/evil', '/%0a/evil'],
  ])('keeps internal path %s', (input, expected) => {
    expect(safeInternalPath(input, FALLBACK)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/\t/evil.example',
    '/\n/evil.example',
    'tai-khoan',
    '/api/auth/sign-out',
    '/api',
    '/_next/static/x.js',
    `/${'a'.repeat(3000)}`,
  ])('falls back for %s', (input) => {
    expect(safeInternalPath(input as string | null | undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('normalises dot segments without leaving the origin', () => {
    expect(safeInternalPath('/a/../../b', FALLBACK)).toBe('/b');
  });
});
