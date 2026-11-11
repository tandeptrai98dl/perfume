import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

/*
 * Cart (M2 cart stream, §10.3): add from the product page → mini-cart → change quantity →
 * cart page → coupon WELCOME10 → totals; out-of-stock variants; language switch keeps the
 * cart. Runs on desktop (1280) and mobile (375) against the demo seed. Each test has its own
 * browser context, hence its own guest cart.
 */

const EDT_SLUG = 'maison-lumiere-cedre-nocturne-edt';
/** Server Action round trips (add, coupon) on a busy CI machine. */
const ACTION = { timeout: 15_000 };

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
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
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

/** "6.400.000 ₫" (vi) and "₫6,400,000" (en): compare digits only. */
const digits = (text: string | null) => (text ?? '').replace(/\D/g, '');

const flows = [
  {
    locale: 'vi',
    pdp: `/san-pham/${EDT_SLUG}`,
    cartPath: '/gio-hang',
    otherCartPath: '/en/cart',
    switchTo: 'English',
    add: 'Thêm vào giỏ',
    added: 'Đã thêm vào giỏ hàng',
    miniTitle: 'Giỏ hàng của bạn',
    increase: 'Tăng số lượng',
    viewCart: 'Xem giỏ hàng',
    couponLabel: 'Mã ưu đãi',
    apply: 'Áp dụng',
    applied: 'Đã áp dụng mã WELCOME10',
    unknownCode: 'Mã ưu đãi không tồn tại',
    freeShipping: 'miễn phí vận chuyển',
    checkout: 'Thanh toán',
    cartHeading: 'Giỏ hàng',
  },
  {
    locale: 'en',
    pdp: `/en/products/${EDT_SLUG}`,
    cartPath: '/en/cart',
    otherCartPath: '/gio-hang',
    switchTo: 'Tiếng Việt',
    add: 'Add to cart',
    added: 'Added to cart',
    miniTitle: 'Your cart',
    increase: 'Increase quantity',
    viewCart: 'View cart',
    couponLabel: 'Promo code',
    apply: 'Apply',
    applied: 'Code WELCOME10 applied',
    unknownCode: 'This promo code does not exist',
    freeShipping: 'free standard shipping',
    checkout: 'Checkout',
    cartHeading: 'Cart',
  },
] as const;

for (const flow of flows) {
  test.describe(`cart (${flow.locale})`, () => {
    test('add from PDP → mini-cart → quantity → coupon → cart totals', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectConsoleErrors(page);
      await page.goto(flow.pdp);
      // Let every streamed boundary hydrate first: the modal sheet hides its siblings
      // (aria-hidden), which would race with late hydration of the announcement bar.
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: flow.add }).click();

      await expect(page.getByText(flow.added).first()).toBeVisible(ACTION);
      const sheet = page.getByRole('dialog', { name: flow.miniTitle });
      await expect(sheet).toBeVisible(ACTION);
      await expect(sheet.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId('header-cart-count')).toHaveText('1');
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      // Quantity 1 → 2 (debounced commit).
      await sheet.getByRole('button', { name: flow.increase }).click();
      await expect(page.getByTestId('header-cart-count')).toHaveText('2', ACTION);
      await expect
        .poll(
          async () => digits(await sheet.getByTestId('mini-cart-subtotal').textContent()),
          ACTION,
        )
        .toBe('6400000');

      await sheet.getByRole('link', { name: flow.viewCart }).click();
      await expect(page).toHaveURL(new RegExp(`${flow.cartPath}$`));
      await expect(page.getByRole('heading', { level: 1, name: flow.cartHeading })).toBeVisible();
      const summary = page.getByTestId('cart-summary');
      await expect
        .poll(async () => digits(await summary.getByTestId('cart-subtotal').textContent()), ACTION)
        .toBe('6400000');
      await expect(summary.getByText(flow.freeShipping)).toBeVisible();

      // Unknown code first: a precise reason, nothing stored.
      const code = summary.getByLabel(flow.couponLabel);
      await code.fill('NOPE');
      await summary.getByRole('button', { name: flow.apply }).click();
      await expect(summary.getByRole('alert')).toContainText(flow.unknownCode, ACTION);

      await code.fill('welcome10');
      await summary.getByRole('button', { name: flow.apply }).click();
      await expect(summary.getByText(flow.applied)).toBeVisible(ACTION);
      // 10% of 6,400,000 capped at 200,000.
      await expect
        .poll(async () => digits(await summary.getByTestId('cart-discount').textContent()), ACTION)
        .toBe('200000');
      await expect
        .poll(async () => digits(await summary.getByTestId('cart-total').textContent()), ACTION)
        .toBe('6200000');
      await expect(summary.getByRole('link', { name: flow.checkout })).toHaveAttribute(
        'href',
        flow.locale === 'vi' ? '/thanh-toan' : '/en/checkout',
      );

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      // The cart follows the visitor to the other language.
      await page.getByRole('link', { name: flow.switchTo }).first().click();
      await expect(page).toHaveURL(new RegExp(`${flow.otherCartPath}$`));
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await expect
        .poll(async () => digits(await page.getByTestId('cart-total').textContent()), ACTION)
        .toBe('6200000');

      expect(errors).toEqual([]);
    });
  });
}

test.describe('out of stock', () => {
  // Changes shared stock: keep it short and restore it whatever happens.
  test.describe.configure({ mode: 'serial' });

  test('an out-of-stock variant shows a disabled "Out of stock" button', async ({ page }) => {
    const databaseUrl = process.env.DATABASE_URL;
    test.skip(!databaseUrl, 'DATABASE_URL is required to change stock');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const { rows } = await client.query<{ id: string; sku: string; on_hand: number }>(
      `select v.id, v.sku, ii.on_hand from product_variants v
       join inventory_items ii on ii.variant_id = v.id
       where v.price = 650000 and v.variant_type = 'travel' limit 1`,
    );
    const variant = rows[0]!;
    try {
      await client.query('update inventory_items set on_hand = reserved where variant_id = $1', [
        variant.id,
      ]);
      const errors = collectConsoleErrors(page);
      await page.goto(`/san-pham/atelier-suong-hoa-dem-edp?v=${encodeURIComponent(variant.sku)}`);
      const button = page.getByTestId('add-to-cart');
      await expect(button).toHaveText('Hết hàng');
      await expect(button).toBeDisabled();
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await client.query('update inventory_items set on_hand = $2 where variant_id = $1', [
        variant.id,
        variant.on_hand,
      ]);
      await client.end();
    }
  });
});

test('empty cart page shows the empty state in both languages', async ({ page }) => {
  await page.goto('/gio-hang');
  await expect(page.getByRole('heading', { name: 'Giỏ hàng đang trống' })).toBeVisible();
  await page.goto('/en/cart');
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
});
