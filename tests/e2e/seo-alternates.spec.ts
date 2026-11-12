import { expect, test, type APIRequestContext } from '@playwright/test';

/*
 * hreflang / canonical validation across the key indexable pages (§13.1, §16.2 "hreflang
 * validation"): every page canonicalises to itself (absolute, no query), lists vi / en /
 * x-default (= vi) alternates, and the English page points back to the same Vietnamese URL
 * (reciprocal pairs). Pages without English content list no `en` alternate; private pages are
 * noindex. Reads the server HTML (what crawlers see); one browserless run is enough.
 */

const BILINGUAL = [
  '/',
  '/nuoc-hoa',
  '/thuong-hieu',
  '/thuong-hieu/maison-lumiere',
  '/danh-muc/nuoc-hoa-nam',
  '/nhom-huong/huong-go',
  '/san-pham/maison-lumiere-cedre-nocturne-edt',
  '/tap-chi',
  '/tap-chi/edt-hay-edp',
  '/chinh-sach/doi-tra',
  '/gioi-thieu',
  '/cam-ket-chinh-hang',
  '/cau-hoi-thuong-gap',
];

/** "Hoa Đêm EDP" has no published English translation (ADR-0021). */
const VI_ONLY = '/san-pham/atelier-suong-hoa-dem-edp';

const NOINDEX = [
  '/gio-hang',
  '/en/cart',
  '/tim-kiem?q=dior',
  '/en/search?q=dior',
  '/ban-tin/xac-nhan',
];

type HeadLinks = { canonical: string[]; alternates: Map<string, string[]>; robots: string[] };

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    out[match[1]!.toLowerCase()] = match[2]!.replace(/&amp;/g, '&');
  }
  return out;
}

/** Canonical, hreflang alternates and robots meta of a server-rendered page. */
async function headLinks(request: APIRequestContext, path: string): Promise<HeadLinks> {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status(), path).toBe(200);
  const html = await response.text();
  const links: HeadLinks = { canonical: [], alternates: new Map(), robots: [] };
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const attrs = attributes(tag);
    if (attrs.rel === 'canonical') links.canonical.push(attrs.href!);
    if (attrs.rel === 'alternate' && attrs.hreflang) {
      links.alternates.set(attrs.hreflang, [
        ...(links.alternates.get(attrs.hreflang) ?? []),
        attrs.href!,
      ]);
    }
  }
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    const attrs = attributes(tag);
    if (attrs.name === 'robots') links.robots.push(attrs.content ?? '');
  }
  return links;
}

function only(values: string[] | undefined, label: string): string {
  expect(values, label).toHaveLength(1);
  return values![0]!;
}

test.describe('hreflang and canonical', () => {
  test.skip(({ isMobile }) => isMobile, 'server HTML is the same for every viewport');

  test('bilingual pages are self-canonical, complete and reciprocal', async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    for (const viPath of BILINGUAL) {
      const vi = await headLinks(request, viPath);
      const canonical = only(vi.canonical, `${viPath} canonical`);
      expect(new URL(canonical).pathname, `${viPath} canonical`).toBe(viPath);
      expect(new URL(canonical).search, `${viPath} canonical has no query`).toBe('');
      expect(canonical.startsWith('http'), `${viPath} canonical is absolute`).toBe(true);
      expect(only(vi.alternates.get('vi'), `${viPath} hreflang=vi`)).toBe(canonical);
      expect(only(vi.alternates.get('x-default'), `${viPath} x-default`)).toBe(canonical);
      const enUrl = only(vi.alternates.get('en'), `${viPath} hreflang=en`);
      expect(new URL(enUrl).pathname, `${viPath} → en`).toMatch(/^\/en(\/|$)/);
      expect(vi.robots.join(' '), `${viPath} robots`).not.toMatch(/noindex/);
      expect(new URL(canonical).origin, `${viPath} origin`).toBe(new URL(baseURL!).origin);

      const en = await headLinks(request, new URL(enUrl).pathname);
      expect(only(en.canonical, `${enUrl} canonical`), `${enUrl} canonical`).toBe(enUrl);
      expect(only(en.alternates.get('en'), `${enUrl} hreflang=en`)).toBe(enUrl);
      expect(only(en.alternates.get('vi'), `${enUrl} hreflang=vi`), `${enUrl} ↔ vi`).toBe(
        canonical,
      );
      expect(only(en.alternates.get('x-default'), `${enUrl} x-default`)).toBe(canonical);
      expect(en.robots.join(' '), `${enUrl} robots`).not.toMatch(/noindex/);
    }
  });

  test('a page without English content has no en alternate', async ({ request }) => {
    const vi = await headLinks(request, VI_ONLY);
    const canonical = only(vi.canonical, 'canonical');
    expect(only(vi.alternates.get('vi'), 'vi')).toBe(canonical);
    expect(only(vi.alternates.get('x-default'), 'x-default')).toBe(canonical);
    expect(vi.alternates.has('en')).toBe(false);
  });

  test('the variant parameter stays out of the canonical and alternates', async ({ request }) => {
    const pdp = await headLinks(
      request,
      '/san-pham/maison-lumiere-cedre-nocturne-edt?v=MAIS-CEDR-EDT-50',
    );
    expect(new URL(only(pdp.canonical, 'pdp canonical')).search).toBe('');
    expect(only(pdp.alternates.get('en'), 'pdp en')).not.toContain('?v=');
  });

  test('private pages are noindex', async ({ request }) => {
    for (const path of NOINDEX) {
      const links = await headLinks(request, path);
      expect(links.robots.join(' '), path).toMatch(/noindex/);
    }
  });
});
