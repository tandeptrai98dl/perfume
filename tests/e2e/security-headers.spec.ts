import { expect, test, type Page, type Response } from '@playwright/test';

import { removeCart, seedCart } from './helpers/cart';

/*
 * Security headers and CSP (ARCHITECTURE.md §12, ADR-0024): every key page in both locales
 * carries the policy and the static headers, and renders, hydrates and runs its scripts
 * without a single CSP violation.
 */

const PDP = 'maison-lumiere-cedre-nocturne-edt';
const SKU = 'ATEL-HOA--EDP-10';

const pages = {
  vi: {
    home: '/',
    listing: '/nuoc-hoa',
    product: `/san-pham/${PDP}`,
    cart: '/gio-hang',
    checkout: '/thanh-toan',
    signIn: '/dang-nhap',
    orderLookup: '/tra-cuu-don-hang',
  },
  en: {
    home: '/en',
    listing: '/en/perfumes',
    product: `/en/products/${PDP}`,
    cart: '/en/cart',
    checkout: '/en/checkout',
    signIn: '/en/sign-in',
    orderLookup: '/en/order-lookup',
  },
} as const;

type Violation = { directive: string; blocked: string; source: string };

/** Records `securitypolicyviolation` events (fired for report-only policies too). */
async function watchViolations(page: Page): Promise<() => Promise<Violation[]>> {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleViolations.push(message.text());
  });
  await page.addInitScript(() => {
    const store: Violation[] = [];
    (window as unknown as { __cspViolations: Violation[] }).__cspViolations = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        source: `${event.sourceFile}:${event.lineNumber}`,
      });
    });
  });
  return async () => {
    const fromPage = await page.evaluate(
      () => (window as unknown as { __cspViolations?: Violation[] }).__cspViolations ?? [],
    );
    return [
      ...fromPage,
      ...consoleViolations.map((text) => ({ directive: 'console', blocked: text, source: '' })),
    ];
  };
}

function expectSecurityHeaders(response: Response | null) {
  expect(response, 'navigation response').not.toBeNull();
  const headers = response!.headers();
  const csp = headers['content-security-policy'] ?? headers['content-security-policy-report-only'];
  expect(csp).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toMatch(
    /script-src 'self' 'unsafe-inline' [^;]*https:\/\/www\.googletagmanager\.com/,
  );
  expect(csp).toContain('https://challenges.cloudflare.com');
  expect(csp).toMatch(/form-action 'self'[^;]*https:\/\/sandbox\.vnpayment\.vn[^;]*pay\.payos\.vn/);
  expect(headers['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['x-frame-options']).toBe('DENY');
}

for (const locale of ['vi', 'en'] as const) {
  test.describe(`security headers (${locale})`, () => {
    for (const [name, path] of Object.entries(pages[locale])) {
      test(`${name}: headers present, no CSP violations`, async ({ page, context, baseURL }) => {
        let cartId: string | null = null;
        if (name === 'checkout') {
          ({ cartId } = await seedCart(baseURL!, context, [{ sku: SKU, quantity: 1 }], {
            locale,
          }));
        }
        try {
          const violations = await watchViolations(page);
          const response = await page.goto(path);
          expect(response?.status()).toBe(200);
          expectSecurityHeaders(response);
          await page.waitForLoadState('networkidle');
          expect(await violations()).toEqual([]);
        } finally {
          if (cartId) await removeCart(cartId);
        }
      });
    }

    test('404 page: headers present, no CSP violations', async ({ page }) => {
      const violations = await watchViolations(page);
      const response = await page.goto(
        locale === 'vi' ? '/khong-co-trang-nay' : '/en/no-such-page',
      );
      expect(response?.status()).toBe(404);
      expectSecurityHeaders(response);
      await page.waitForLoadState('networkidle');
      expect(await violations()).toEqual([]);
    });
  });
}

test('admin login: headers present, noindex, no CSP violations', async ({ page }) => {
  const violations = await watchViolations(page);
  const response = await page.goto('/admin/login');
  expectSecurityHeaders(response);
  expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await page.waitForLoadState('networkidle');
  expect(await violations()).toEqual([]);
});

test('API responses get the deny-all policy and the static headers', async ({ request }) => {
  const response = await request.get('/api/health');
  const headers = response.headers();
  expect(headers['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'; sandbox",
  );
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['strict-transport-security']).toBeTruthy();
});

test('product Open Graph card renders as a PNG in both locales', async ({ page, request }) => {
  for (const path of [pages.vi.product, pages.en.product]) {
    await page.goto(path);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image, path).toMatch(/opengraph-image/);
    const response = await request.get(new URL(image!).pathname);
    expect(response.status(), image!).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect((await response.body()).byteLength).toBeGreaterThan(10_000);
  }
});
