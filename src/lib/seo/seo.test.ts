import { describe, expect, it } from 'vitest';

import { articleJsonLd, faqPageJsonLd, serializeJsonLd } from './content-json-ld';
import { contentMetadata, hreflang, truncate } from './content-metadata';

describe('content metadata', () => {
  it('truncates at word boundaries', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('Nước hoa chính hãng cho mọi dịp trong năm', 20)).toBe('Nước hoa chính hãng…');
  });

  it('emits hreflang only for published locales with x-default = vi', () => {
    expect(hreflang('https://shop.vn', { vi: '/tap-chi/a', en: '/en/journal/a' })).toEqual({
      vi: 'https://shop.vn/tap-chi/a',
      en: 'https://shop.vn/en/journal/a',
      'x-default': 'https://shop.vn/tap-chi/a',
    });
    expect(hreflang('https://shop.vn', { vi: '/tap-chi/b' })).toEqual({
      vi: 'https://shop.vn/tap-chi/b',
      'x-default': 'https://shop.vn/tap-chi/b',
    });
  });

  it('builds canonical and Open Graph data', () => {
    const metadata = contentMetadata({
      origin: 'https://shop.vn',
      locale: 'en',
      title: 'EDT or EDP',
      description: 'Which one?',
      path: '/en/journal/edt-or-edp',
      alternates: { vi: '/tap-chi/edt-hay-edp', en: '/en/journal/edt-or-edp' },
      type: 'article',
      publishedTime: new Date('2026-11-01T00:00:00Z'),
    });
    expect(metadata.alternates?.canonical).toBe('https://shop.vn/en/journal/edt-or-edp');
    expect(metadata.openGraph).toMatchObject({
      type: 'article',
      locale: 'en_US',
      alternateLocale: ['vi_VN'],
      publishedTime: '2026-11-01T00:00:00.000Z',
    });
  });
});

describe('JSON-LD', () => {
  it('escapes script-breaking characters', () => {
    expect(serializeJsonLd({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });

  it('builds Article and FAQPage objects', () => {
    const article = articleJsonLd({
      url: 'https://shop.vn/tap-chi/a',
      headline: 'A',
      description: 'B',
      datePublished: new Date('2026-11-01T00:00:00Z'),
      dateModified: new Date('2026-11-02T00:00:00Z'),
      inLanguage: 'vi',
      siteName: 'Perfume Store',
      siteUrl: 'https://shop.vn',
    });
    expect(article).toMatchObject({ '@type': 'Article', author: { '@type': 'Organization' } });
    expect(
      faqPageJsonLd({ url: 'u', inLanguage: 'en', entries: [{ question: 'Q', answer: 'A' }] })
        .mainEntity,
    ).toEqual([
      { '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } },
    ]);
  });
});
