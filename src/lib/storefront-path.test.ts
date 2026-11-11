import { describe, expect, it } from 'vitest';

import { localizedPath } from './seo/paths';
import { storefrontPath } from './storefront-path';

describe('storefrontPath', () => {
  it('matches the SEO path builder used by the proxy and sitemaps', () => {
    expect(storefrontPath('product', 'vi', 'a-b')).toBe(
      localizedPath('vi', '/products/[slug]', { slug: 'a-b' }),
    );
    expect(storefrontPath('family', 'en', 'woody')).toBe(
      localizedPath('en', '/scent-families/[slug]', { slug: 'woody' }),
    );
  });

  it('allows an empty slug for the admin path preview', () => {
    expect(storefrontPath('brand', 'vi', '')).toBe('/thuong-hieu/');
    expect(storefrontPath('brand', 'en', '')).toBe('/en/brands/');
  });
});
