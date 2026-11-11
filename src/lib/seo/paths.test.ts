import { describe, expect, it } from 'vitest';

import { absoluteUrl, localizedPath, matchLocalizedPath } from './paths';

describe('localizedPath', () => {
  it('builds Vietnamese paths without prefix and English under /en', () => {
    expect(localizedPath('vi', '/')).toBe('/');
    expect(localizedPath('en', '/')).toBe('/en');
    expect(localizedPath('vi', '/journal/[slug]', { slug: 'mui-go' })).toBe('/tap-chi/mui-go');
    expect(localizedPath('en', '/journal/[slug]', { slug: 'woody' })).toBe('/en/journal/woody');
    expect(localizedPath('vi', '/about')).toBe('/gioi-thieu');
    expect(localizedPath('en', '/policies/[slug]', { slug: 'returns' })).toBe(
      '/en/policies/returns',
    );
  });

  it('requires params', () => {
    expect(() => localizedPath('vi', '/journal/[slug]')).toThrow(/slug/);
  });

  it('joins absolute URLs', () => {
    expect(absoluteUrl('https://shop.vn/', '/en')).toBe('https://shop.vn/en');
  });
});

describe('matchLocalizedPath', () => {
  it.each([
    ['/', { locale: 'vi', pathname: '/', params: {} }],
    ['/en', { locale: 'en', pathname: '/', params: {} }],
    ['/tap-chi/mui-go', { locale: 'vi', pathname: '/journal/[slug]', params: { slug: 'mui-go' } }],
    [
      '/tap-chi/chu-de/qua-tang',
      { locale: 'vi', pathname: '/journal/topics/[slug]', params: { slug: 'qua-tang' } },
    ],
    ['/en/about/', { locale: 'en', pathname: '/about', params: {} }],
    [
      '/chinh-sach/doi-tra',
      { locale: 'vi', pathname: '/policies/[slug]', params: { slug: 'doi-tra' } },
    ],
  ])('%s', (path, expected) => {
    expect(matchLocalizedPath(path)).toEqual(expected);
  });

  it('returns null for unknown paths', () => {
    expect(matchLocalizedPath('/khong-ton-tai/x/y')).toBeNull();
    expect(matchLocalizedPath('/en/gioi-thieu')).toBeNull();
  });
});
