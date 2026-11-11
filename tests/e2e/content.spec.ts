import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Content pages, redirects and SEO files (M1 stream C). Relies on the demo seed
 * (`pnpm db:seed`): policies, two journal posts, an unpublished English cookie policy and the
 * redirect /tap-chi/cach-chon-nong-do-nuoc-hoa → /tap-chi/edt-hay-edp.
 */

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function jsonLd(page: Page, type: string) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((text) => JSON.parse(text)).find((data) => data['@type'] === type);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('policy pages', () => {
  test('Vietnamese policy renders with breadcrumb and footer legal links', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/chinh-sach/doi-tra');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chính sách đổi trả');
    await expect(page.getByText('Bạn có thể yêu cầu đổi trả trong vòng 7 ngày')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Chính sách' }).getByRole('link', {
        name: 'Chính sách bảo mật',
      }),
    ).toHaveAttribute('href', '/chinh-sach/bao-mat');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/chinh-sach\/doi-tra$/,
    );
    await expectNoOverflow(page);
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('English policy renders with the Vietnamese-prevails notice and hreflang', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/en/policies/returns');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Returns policy');
    await expect(page.getByText('the Vietnamese version prevails')).toBeVisible();
    await expect(page.locator('link[rel="alternate"][hreflang="vi"]')).toHaveAttribute(
      'href',
      /\/chinh-sach\/doi-tra$/,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      'href',
      /\/chinh-sach\/doi-tra$/,
    );
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('an unpublished English page is not visible under /en', async ({ page }) => {
    const response = await page.goto('/en/policies/cookie-policy');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    // The Vietnamese version is live.
    expect((await page.goto('/chinh-sach/chinh-sach-cookie'))?.status()).toBe(200);
  });

  test('unknown content slugs return 404', async ({ page }) => {
    expect((await page.goto('/chinh-sach/khong-co'))?.status()).toBe(404);
    expect((await page.goto('/en/journal/does-not-exist'))?.status()).toBe(404);
  });
});

test.describe('journal', () => {
  test('Vietnamese post renders with Article JSON-LD', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tap-chi/edt-hay-edp');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'EDT hay EDP: chọn nồng độ nào cho bạn?',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Eau de Parfum' })).toBeVisible();
    const article = await jsonLd(page, 'Article');
    expect(article).toMatchObject({
      headline: 'EDT hay EDP: chọn nồng độ nào cho bạn?',
      inLanguage: 'vi',
    });
    expect(article.url).toMatch(/\/tap-chi\/edt-hay-edp$/);
    await expectNoOverflow(page);
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('English post renders and the language switcher finds the equivalent post', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/tap-chi/edt-hay-edp');
    // The switcher streams in after the static shell (whose fallback links to the home page).
    const english = page.getByRole('link', { name: 'English' });
    await expect(english).not.toHaveAttribute('href', '/en');
    await english.click();
    await expect(page).toHaveURL(/\/en\/journal\/edt-or-edp$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'EDT or EDP: which concentration suits you?',
    );
    expect((await jsonLd(page, 'Article')).inLanguage).toBe('en');
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('journal index lists posts per locale and links topics', async ({ page }) => {
    await page.goto('/tap-chi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tạp chí');
    await expect(
      page.getByRole('link', { name: 'EDT hay EDP: chọn nồng độ nào cho bạn?' }),
    ).toHaveAttribute('href', '/tap-chi/edt-hay-edp');
    await page.getByRole('link', { name: 'Quà tặng' }).first().click();
    await expect(page).toHaveURL(/\/tap-chi\/chu-de\/qua-tang$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quà tặng');

    await page.goto('/en/journal');
    await expect(
      page.getByRole('link', { name: 'EDT or EDP: which concentration suits you?' }),
    ).toBeVisible();
    // The Vietnamese-only post is not listed in English.
    await expect(page.getByText('Gợi ý tặng nước hoa')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('information pages', () => {
  for (const { path, title, lang } of [
    { path: '/cau-hoi-thuong-gap', title: 'Câu hỏi thường gặp', lang: 'vi' },
    { path: '/en/faq', title: 'Frequently asked questions', lang: 'en' },
  ]) {
    test(`FAQ (${lang}) has FAQPage JSON-LD and keyboard-operable answers`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      const faq = await jsonLd(page, 'FAQPage');
      expect(faq.mainEntity).toHaveLength(3);
      const first = page.getByRole('button', { name: faq.mainEntity[0].name });
      await first.focus();
      await page.keyboard.press('Enter');
      await expect(first).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByText(faq.mainEntity[0].acceptedAnswer.text)).toBeVisible();
      await expectNoAxeViolations(page);
      expect(errors).toEqual([]);
    });
  }

  test('about, authenticity and contact render in both locales', async ({ page }) => {
    for (const [path, title] of [
      ['/gioi-thieu', 'Về chúng tôi'],
      ['/cam-ket-chinh-hang', 'Cam kết chính hãng'],
      ['/lien-he', 'Liên hệ'],
      ['/en/about', 'About us'],
      ['/en/authenticity', 'Authenticity guarantee'],
      ['/en/contact', 'Contact'],
    ]) {
      const response = await page.goto(path!);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(title!);
    }
    await expect(page.getByRole('heading', { name: 'Contact details' })).toBeVisible();
  });
});

test.describe('announcement bar', () => {
  test('is dismissible and stays dismissed', async ({ page }) => {
    await page.goto('/chinh-sach/giao-hang');
    const bar = page.getByRole('complementary', { name: 'Thông báo' });
    await expect(bar).toContainText('Cam kết chính hãng');
    await bar.getByRole('button', { name: 'Ẩn thông báo' }).click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Thông báo' })).toHaveCount(0);
  });
});

test.describe('redirects and SEO files', () => {
  test('a seeded redirect returns 301 to the target', async ({ request }) => {
    const response = await request.get('/tap-chi/cach-chon-nong-do-nuoc-hoa?utm_source=test', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toMatch(/\/tap-chi\/edt-hay-edp\?utm_source=test$/);
  });

  test('robots.txt blocks private pages in both locales and links the sitemap', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    for (const path of [
      '/admin',
      '/api/',
      '/gio-hang',
      '/en/cart',
      '/thanh-toan',
      '/en/checkout',
      '/tai-khoan',
      '/en/account',
      '/tim-kiem',
      '/en/search',
    ]) {
      expect(body).toContain(`Disallow: ${path}\n`);
    }
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test('sitemap index and child sitemaps are valid XML with alternates', async ({
    page,
    request,
  }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('application/xml');
    const indexXml = await index.text();

    const journal = await request.get('/sitemaps/journal.xml');
    expect(journal.status()).toBe(200);
    const journalXml = await journal.text();

    await page.goto('about:blank');
    const parsed = await page.evaluate(
      ([a, b]) =>
        [a, b].map((xml) => {
          const doc = new DOMParser().parseFromString(xml!, 'application/xml');
          return {
            error: doc.getElementsByTagName('parsererror').length > 0,
            locs: [...doc.getElementsByTagName('loc')].map((n) => n.textContent),
            alternates: [...doc.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link')].map(
              (n) => `${n.getAttribute('hreflang')} ${n.getAttribute('href')}`,
            ),
          };
        }),
      [indexXml, journalXml],
    );
    expect(parsed[0]!.error).toBe(false);
    expect(parsed[0]!.locs.some((loc) => loc?.endsWith('/sitemaps/pages.xml'))).toBe(true);
    expect(parsed[1]!.error).toBe(false);
    expect(parsed[1]!.locs.some((loc) => loc?.endsWith('/tap-chi/edt-hay-edp'))).toBe(true);
    expect(parsed[1]!.alternates.some((a) => /^en .*\/en\/journal\/edt-or-edp$/.test(a!))).toBe(
      true,
    );
    expect(parsed[1]!.alternates.some((a) => /^x-default .*\/tap-chi\/edt-hay-edp$/.test(a!))).toBe(
      true,
    );

    const pages = await (await request.get('/sitemaps/pages.xml')).text();
    expect(pages).toContain('/chinh-sach/chinh-sach-cookie');
    expect(pages).not.toContain('/en/policies/cookie-policy');
    expect((await request.get('/sitemaps/unknown.xml')).status()).toBe(404);
  });
});
