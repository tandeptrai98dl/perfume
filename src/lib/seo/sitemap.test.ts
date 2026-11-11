import { describe, expect, it } from 'vitest';

import { buildSitemapIndex, buildUrlSet, escapeXml, urlsFromAlternates } from './sitemap';

describe('sitemap builders', () => {
  it('expands each entity into one URL per published locale with alternates', () => {
    const urls = urlsFromAlternates('https://shop.vn', [
      {
        alternates: { vi: '/tap-chi/edt-hay-edp', en: '/en/journal/edt-or-edp' },
        lastModified: new Date('2026-11-02T00:00:00Z'),
      },
      { alternates: { vi: '/tap-chi/chi-tieng-viet' } },
    ]);
    expect(urls).toEqual([
      {
        loc: 'https://shop.vn/tap-chi/edt-hay-edp',
        lastModified: new Date('2026-11-02T00:00:00Z'),
        alternates: {
          vi: 'https://shop.vn/tap-chi/edt-hay-edp',
          en: 'https://shop.vn/en/journal/edt-or-edp',
          'x-default': 'https://shop.vn/tap-chi/edt-hay-edp',
        },
      },
      expect.objectContaining({ loc: 'https://shop.vn/en/journal/edt-or-edp' }),
      {
        loc: 'https://shop.vn/tap-chi/chi-tieng-viet',
        lastModified: undefined,
        alternates: {
          vi: 'https://shop.vn/tap-chi/chi-tieng-viet',
          'x-default': 'https://shop.vn/tap-chi/chi-tieng-viet',
        },
      },
    ]);
  });

  it('renders a valid urlset with xhtml alternates and escaped values', () => {
    const xml = buildUrlSet([
      {
        loc: 'https://shop.vn/a?x=1&y=2',
        lastModified: '2026-11-02T00:00:00Z',
        alternates: { vi: 'https://shop.vn/a', 'x-default': 'https://shop.vn/a' },
      },
      { loc: 'https://shop.vn/b', lastModified: new Date(0) },
    ]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('<loc>https://shop.vn/a?x=1&amp;y=2</loc>');
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://shop.vn/a"/>',
    );
    expect(xml).toContain('<lastmod>2026-11-02T00:00:00.000Z</lastmod>');
    // Epoch dates are treated as "unknown" and omitted.
    expect(xml).toContain('<url><loc>https://shop.vn/b</loc></url>');
  });

  it('renders a sitemap index', () => {
    expect(buildSitemapIndex([{ loc: 'https://shop.vn/sitemaps/pages.xml' }])).toContain(
      '<sitemap><loc>https://shop.vn/sitemaps/pages.xml</loc></sitemap>',
    );
  });

  it('escapes XML special characters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });
});
