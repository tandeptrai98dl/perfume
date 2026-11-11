import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Bilingual catalogue (M1 stream A): listing → filter → PDP → variant → language switch,
 * English visibility rules, search, accessibility and layout. Runs on desktop (1280) and
 * mobile (375) projects against the demo seed (pnpm db:seed).
 */

const EDT_SLUG = 'maison-lumiere-cedre-nocturne-edt';

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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
}

/** Visible cards only: earlier routes stay in the DOM as hidden <Activity> content. */
const cards = (page: Page) => page.getByTestId('product-card').filter({ visible: true });

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

/** Ticks a filter option in the sidebar (desktop) or the filter sheet (mobile). */
async function applyFilter(
  page: Page,
  option: RegExp,
  sheetLabels: { open: RegExp; show: RegExp },
) {
  if (isMobile(page)) {
    await page.getByRole('button', { name: sheetLabels.open }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('checkbox', { name: option }).click();
    await expect(sheet.getByRole('checkbox', { name: option })).toBeChecked();
    await sheet.getByRole('button', { name: sheetLabels.show }).click();
    await expect(sheet).toBeHidden();
  } else {
    const sidebar = page.getByRole('complementary');
    await sidebar.getByRole('checkbox', { name: option }).click();
    await expect(sidebar.getByRole('checkbox', { name: option })).toBeChecked();
  }
}

const flows = [
  {
    locale: 'vi',
    listing: '/nuoc-hoa',
    heading: 'Nước hoa chính hãng',
    filter: /Maison Lumière/,
    filterQuery: /\?brand=maison-lumiere$/,
    sheet: { open: /^Bộ lọc/, show: /Xem 2 sản phẩm/ },
    pdp: `/san-pham/${EDT_SLUG}`,
    defaultPrice: '3.200.000 ₫',
    variantName: '50 ml',
    variantPrice: '2.300.000 ₫',
    switchTo: 'English',
    otherPdp: `/en/products/${EDT_SLUG}`,
    otherHref: `/en/products/${EDT_SLUG}`,
    otherLang: 'en',
  },
  {
    locale: 'en',
    listing: '/en/perfumes',
    heading: 'Authentic perfumes',
    filter: /^Men/,
    filterQuery: /\?gender=male$/,
    sheet: { open: /^Filters/, show: /Show 2 products/ },
    pdp: `/en/products/${EDT_SLUG}`,
    defaultPrice: '₫3,200,000',
    variantName: '50 ml',
    variantPrice: '₫2,300,000',
    switchTo: 'Tiếng Việt',
    otherPdp: `/san-pham/${EDT_SLUG}`,
    otherHref: `/vi/san-pham/${EDT_SLUG}`,
    otherLang: 'vi',
  },
] as const;

for (const flow of flows) {
  test.describe(`catalogue flow (${flow.locale})`, () => {
    test('listing → filter → product → variant → language switch', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(flow.listing);
      await expect(page.getByRole('heading', { level: 1, name: flow.heading })).toBeVisible();
      // Interact only once streamed sections have hydrated (a modal sheet opened earlier
      // would mark not-yet-hydrated siblings aria-hidden and trigger a hydration warning).
      await page.waitForLoadState('networkidle');
      await expect(cards(page)).toHaveCount(flow.locale === 'vi' ? 4 : 3);

      await applyFilter(page, flow.filter, flow.sheet);
      await expect(page).toHaveURL(flow.filterQuery);
      await expect(cards(page)).toHaveCount(2);

      // Reload keeps the filters (URL state).
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(cards(page)).toHaveCount(2);
      await expect(
        page.getByRole('link', { name: new RegExp(flow.filter.source.replace('^', '')) }).first(),
      ).toBeVisible();

      await page.getByRole('link', { name: 'Cèdre Nocturne EDT' }).click();
      await expect(page).toHaveURL(new RegExp(`${flow.pdp}$`));
      await expect(
        page.getByRole('heading', { level: 1, name: 'Cèdre Nocturne EDT' }),
      ).toBeVisible();
      const offer = page.getByTestId('variant-offer');
      await expect(offer).toContainText(flow.defaultPrice);

      await page.getByRole('radio', { name: flow.variantName }).click();
      await expect(page).toHaveURL(new RegExp(`\\?v=MAIS-CEDR-EDT-50$`));
      await expect(offer).toContainText(flow.variantPrice);
      await expect(page.getByRole('radio', { name: flow.variantName })).toBeChecked();

      // Deep link with ?v= selects the variant on load.
      await page.reload();
      await expect(page.getByTestId('variant-offer')).toContainText(flow.variantPrice);

      const switcher = page.getByRole('link', { name: flow.switchTo });
      // next-intl prefixes the default locale (/vi/…) so the proxy can store the choice.
      await expect(switcher).toHaveAttribute('href', flow.otherHref);
      await switcher.click();
      await expect(page).toHaveURL(new RegExp(`${flow.otherPdp}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', flow.otherLang);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Cèdre Nocturne EDT' }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

const PAGES = [
  '/',
  '/nuoc-hoa',
  '/nuoc-hoa?brand=maison-lumiere&gender=male',
  `/san-pham/${EDT_SLUG}`,
  '/san-pham/atelier-suong-hoa-dem-edp',
  '/thuong-hieu',
  '/thuong-hieu/maison-lumiere',
  '/nhom-huong/huong-go',
  '/danh-muc/nuoc-hoa-nam',
  '/tim-kiem?q=go',
  '/tim-kiem?q=xyzxyz',
  '/en',
  '/en/perfumes',
  `/en/products/${EDT_SLUG}`,
  '/en/brands',
  '/en/brands/maison-lumiere',
  '/en/scent-families/woody',
  '/en/search?q=woody',
];

test.describe('catalogue pages', () => {
  for (const path of PAGES) {
    test(`${path} is accessible, error-free and fits the viewport`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Streamed sections have replaced their skeletons.
      await expect(page.locator('main .animate-shimmer')).toHaveCount(0);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('English visibility (ADR-0021)', () => {
  test('/en never shows a product without a published English translation', async ({ page }) => {
    for (const path of [
      '/en',
      '/en/perfumes',
      '/en/perfumes?gender=female',
      '/en/brands/atelier-suong',
      '/en/search?q=hoa+dem',
      '/en/scent-families/floral',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // innerText: earlier routes stay in the DOM as hidden <Activity> content.
      await expect(page.locator('body')).not.toContainText('Hoa Đêm', { useInnerText: true });
    }
    const response = await page.goto('/en/products/atelier-suong-hoa-dem-edp');
    expect(response?.status()).toBe(404);
  });

  test('the switcher sends an untranslated product to the English listing', async ({ page }) => {
    await page.goto('/san-pham/atelier-suong-hoa-dem-edp');
    await expect(page.getByRole('heading', { level: 1, name: 'Hoa Đêm EDP' })).toBeVisible();
    const english = page.getByRole('link', { name: 'English' });
    await expect(english).toHaveAttribute('href', '/en/perfumes');
    await english.click();
    await expect(page).toHaveURL(/\/en\/perfumes$/);
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('body')).not.toContainText('Hoa Đêm', { useInnerText: true });
  });
});

test.describe('product SEO', () => {
  test('canonical drops ?v= and hreflang uses each locale', async ({ page }) => {
    await page.goto(`/san-pham/${EDT_SLUG}?v=MAIS-CEDR-EDT-50`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/san-pham/${EDT_SLUG}$`),
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      new RegExp(`/en/products/${EDT_SLUG}$`),
    );
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = jsonLd
      .map((text) => JSON.parse(text))
      .find((data) => data['@type'] === 'Product');
    expect(product.offers).toMatchObject({
      '@type': 'AggregateOffer',
      priceCurrency: 'VND',
      lowPrice: 2_300_000,
      highPrice: 3_200_000,
    });

    await page.goto('/san-pham/atelier-suong-hoa-dem-edp');
    await expect(page.locator('link[rel="alternate"][hreflang="vi"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(0);
  });

  test('search and multi-filter listings are noindex', async ({ page }) => {
    await page.goto('/tim-kiem?q=go');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto('/nuoc-hoa?brand=maison-lumiere&gender=male');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto('/nuoc-hoa');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});

test.describe('search dialog', () => {
  test('Ctrl+K opens suggestions; Enter shows all results', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Tìm kiếm' })).toBeVisible();
    await page.waitForLoadState('networkidle'); // hydrated: the shortcut listener is attached
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('lumi');
    await expect(dialog.getByRole('option', { name: /Cèdre Nocturne EDT/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: 'Maison Lumière', exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tim-kiem\?q=lumi$/);
    await expect(cards(page)).toHaveCount(2);
  });
});
