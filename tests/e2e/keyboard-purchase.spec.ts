import { test } from '@playwright/test';

import {
  chooseRadio,
  expectFocusVisible,
  moveToOption,
  pickOption,
  tabTo,
  tick,
  typeInto,
} from './helpers/keyboard';
import {
  cleanupPurchases,
  codeFromUrl,
  collectConsoleErrors,
  digits,
  expect,
  FLOWS,
  newShopper,
  orderByCode,
  PRODUCTS,
  type Shopper,
} from './helpers/purchase';

/*
 * Keyboard-only purchase (M2 exit checklist, WCAG 2.1.1 / 2.4.7): from the home page to a
 * placed COD order with Tab, Shift+Tab, Enter, Space, arrow keys and typing only: search
 * dialog → product → size radio → add to cart → mini-cart → cart → checkout (combobox
 * address, radio delivery and payment, consent checkboxes) → place order. vi and en.
 * Desktop only: keyboard users browse with a physical keyboard (375 px is covered by the
 * pointer specs).
 */

const KEYBOARD = {
  vi: {
    flow: FLOWS.vi,
    searchLabel: 'Tìm kiếm',
    query: 'hoa dem',
    option: /Hoa Đêm EDP/,
    productHeading: 'Hoa Đêm EDP',
    product: PRODUCTS.fullSize,
    size: '75 ml',
    otherSize: 'Du lịch 10 ml',
  },
  en: {
    flow: FLOWS.en,
    searchLabel: 'Search',
    query: 'cedre nocturne',
    option: /Cèdre Nocturne EDT/,
    productHeading: 'Cèdre Nocturne EDT',
    product: PRODUCTS.edt100,
    size: '100 ml',
    otherSize: '50 ml',
  },
} as const;

for (const run of Object.values(KEYBOARD)) {
  const { flow } = run;

  test.describe(`keyboard-only purchase (${flow.locale})`, () => {
    let shopper: Shopper;

    test.beforeEach(async ({ context, isMobile }) => {
      test.skip(isMobile, 'keyboard-only run is a desktop scenario');
      shopper = newShopper(flow.locale);
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': shopper.ip });
    });

    test.afterEach(async ({ context }) => {
      if (shopper) await cleanupPurchases(shopper.email, context);
    });

    test('home → search → product → cart → checkout → COD order', async ({ page }) => {
      test.setTimeout(180_000);
      const errors = collectConsoleErrors(page);
      const { product } = run;

      // Home: the skip link comes first, then the header; open the search dialog.
      await page.goto(flow.locale === 'vi' ? '/' : '/en');
      await page.waitForLoadState('networkidle');
      await tabTo(page, page.getByRole('link', { name: run.searchLabel }));
      await expectFocusVisible(page);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.keyboard.type(run.query);
      const option = dialog.getByRole('option', { name: run.option });
      await expect(option).toBeVisible();
      await moveToOption(page, option);
      await page.keyboard.press('Enter');

      // Product page: size with arrow keys, add to cart with Enter.
      await expect(page.getByRole('heading', { level: 1, name: run.productHeading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Arrow keys move through the sizes (and update the price); end on the wanted size.
      const other = page.getByRole('radio', { name: run.otherSize, exact: true });
      const size = page.getByRole('radio', { name: run.size, exact: true });
      await chooseRadio(page, other);
      await expect(size).not.toBeChecked();
      await chooseRadio(page, size);
      await expect(other).not.toBeChecked();
      await expect
        .poll(async () => digits(await page.getByTestId('variant-offer').textContent()))
        .toContain(String(product.price));
      const add = page.getByTestId('add-to-cart');
      await tabTo(page, add);
      await expectFocusVisible(page);
      await page.keyboard.press('Enter');

      // Mini-cart: focus moves into the sheet; Tab stays inside it.
      const sheet = page.getByRole('dialog', { name: flow.miniTitle });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId('header-cart-count')).toHaveText('1');
      await tabTo(page, sheet.getByRole('link', { name: flow.viewCart }), { max: 40 });
      await page.keyboard.press('Enter');

      // Cart page → checkout.
      await expect(page).toHaveURL(flow.cartPath);
      await page.waitForLoadState('networkidle');
      const summary = page.getByTestId('cart-summary');
      await expect
        .poll(async () => digits(await summary.getByTestId('cart-subtotal').textContent()))
        .toBe(String(product.price));
      await tabTo(page, summary.getByRole('link', { name: flow.toCheckout }));
      await page.keyboard.press('Enter');

      // Checkout: text fields, comboboxes, radio groups and checkboxes by keyboard.
      await expect(page).toHaveURL(flow.checkoutPath);
      await expect(
        page.getByRole('heading', { level: 1, name: flow.checkoutHeading }),
      ).toBeVisible();
      await page.waitForLoadState('networkidle');
      const textbox = (name: string) => page.getByRole('textbox', { name, exact: true });
      await typeInto(page, textbox(flow.labels.email), shopper.email);
      await typeInto(page, textbox(flow.labels.phone), shopper.phone);
      await typeInto(page, textbox(flow.labels.fullName), shopper.name);
      await pickOption(
        page,
        page.getByRole('combobox', { name: flow.labels.province }),
        flow.provinceSearch,
        flow.provinceOption,
      );
      await pickOption(
        page,
        page.getByRole('combobox', { name: flow.labels.ward }),
        flow.wardSearch,
        flow.wardOption,
      );
      await typeInto(page, textbox(flow.labels.street), '12 Lê Lợi');
      await chooseRadio(page, page.getByRole('radio', { name: flow.shipping.standard }));
      await chooseRadio(page, page.getByRole('radio', { name: flow.methods.cod }));
      await tick(page, page.getByRole('checkbox', { name: flow.terms }));
      await tick(page, page.getByRole('checkbox', { name: flow.privacy }));

      // Above 2,000,000 ₫ standard delivery is free; COD below 5,000,000 ₫ needs no deposit.
      await expect
        .poll(async () => digits(await page.getByTestId('order-total').textContent()))
        .toBe(String(product.price));
      await expect(page.getByTestId('deposit-notice')).toHaveCount(0);

      const placeOrder = page.getByRole('button', { name: flow.placeOrder, exact: true });
      await tabTo(page, placeOrder);
      await expectFocusVisible(page);
      await page.keyboard.press('Enter');

      await expect(page).toHaveURL(flow.resultPath);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.codConfirm);
      const order = await orderByCode(codeFromUrl(page.url()));
      expect(order).toMatchObject({
        status: 'awaiting_confirmation',
        payment_method: 'cod',
        locale: flow.locale,
        total: product.price,
        email: shopper.email,
      });
      expect(errors).toEqual([]);
    });
  });
}
