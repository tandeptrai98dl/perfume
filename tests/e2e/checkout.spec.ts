import { randomInt } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { findOrder, removeCart, removeOrdersByEmail, seedCart } from './helpers/cart';

/*
 * One-page checkout (M2 stream "checkout", §10.4): fill contact → address → delivery →
 * payment, place a COD order and an online order, deposit notice for high-value COD,
 * validation errors, accessibility, empty-cart redirect. Runs in vi and en on desktop (1280)
 * and mobile (375). The cart is seeded in the DB (the cart UI is another stream); the result
 * page belongs to the payments stream, so the specs assert the redirect URL and the order row.
 */

const SKU = { travel: 'ATEL-HOA--EDP-10', parfum: 'AMBR-SOLE-PARFUM-50' } as const;

const flows = [
  {
    locale: 'vi' as const,
    checkout: '/thanh-toan',
    cart: /\/gio-hang$/,
    result: /\/thanh-toan\/ket-qua\?code=(PF-\d{6}-[2-9A-HJKMNP-Z]{4})$/,
    title: 'Thanh toán',
    labels: {
      email: 'Email',
      phone: 'Số điện thoại di động',
      fullName: 'Họ và tên',
      province: 'Tỉnh / thành phố',
      ward: 'Phường / xã',
      street: 'Địa chỉ cụ thể',
    },
    provinceSearch: 'ho chi minh',
    provinceOption: 'Thành phố Hồ Chí Minh',
    wardSearch: 'ben thanh',
    wardOption: 'Phường Bến Thành',
    cod: /Thanh toán khi nhận hàng/,
    vietqr: /Chuyển khoản qua VietQR/,
    terms: /Điều khoản mua hàng/,
    privacy: /Chính sách bảo mật/,
    placeOrder: 'Đặt hàng',
    placeOrderPay: 'Đặt hàng và thanh toán',
    fixErrors: 'Vui lòng kiểm tra các trường được đánh dấu.',
    required: 'Vui lòng nhập thông tin này.',
    phoneInvalid: 'Vui lòng nhập số di động Việt Nam 10 chữ số, ví dụ 0912 345 678.',
    consentRequired: 'Vui lòng đồng ý để tiếp tục.',
    deposit: 'Đơn COD này cần đặt cọc',
    freeShipping: 'Miễn phí',
  },
  {
    locale: 'en' as const,
    checkout: '/en/checkout',
    cart: /\/en\/cart$/,
    result: /\/en\/checkout\/result\?code=(PF-\d{6}-[2-9A-HJKMNP-Z]{4})$/,
    title: 'Checkout',
    labels: {
      email: 'Email',
      phone: 'Mobile number',
      fullName: 'Full name',
      province: 'Province / city',
      ward: 'Ward / commune',
      street: 'Street address',
    },
    // English shows names without diacritics; search accepts the Vietnamese spelling too.
    provinceSearch: 'Hồ Chí Minh',
    provinceOption: 'Thanh pho Ho Chi Minh',
    wardSearch: 'Bến Thành',
    wardOption: 'Phuong Ben Thanh',
    cod: /Cash on delivery/,
    vietqr: /Bank transfer by VietQR/,
    terms: /Terms of sale/,
    privacy: /Privacy policy/,
    placeOrder: 'Place order',
    placeOrderPay: 'Place order and pay',
    fixErrors: 'Please check the highlighted fields.',
    required: 'This field is required.',
    phoneInvalid: 'Enter a 10-digit Vietnamese mobile number, e.g. 0912 345 678.',
    consentRequired: 'Please accept to continue.',
    deposit: 'A deposit is required for this COD order',
    freeShipping: 'Free',
  },
];

type Flow = (typeof flows)[number];

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
  expect(overflow).toBeLessThanOrEqual(0);
}

async function pick(page: Page, combobox: string, search: string, option: string) {
  const trigger = page.getByRole('combobox', { name: combobox });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.keyboard.type(search);
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}

const textbox = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

async function fillCheckout(page: Page, flow: Flow, phone: string, email: string) {
  await textbox(page, flow.labels.email).fill(email);
  await textbox(page, flow.labels.phone).fill(phone);
  await textbox(page, flow.labels.fullName).fill('Nguyễn Thị E2E');
  await pick(page, flow.labels.province, flow.provinceSearch, flow.provinceOption);
  await pick(page, flow.labels.ward, flow.wardSearch, flow.wardOption);
  await textbox(page, flow.labels.street).fill('12 Lê Lợi');
  // The first delivery option is preselected once the province is known.
  await expect(page.getByRole('radiogroup').first().getByRole('radio').first()).toBeChecked();
}

async function acceptConsents(page: Page, flow: Flow) {
  await page.getByRole('checkbox', { name: flow.terms }).click();
  await page.getByRole('checkbox', { name: flow.privacy }).click();
}

/** Unique client IP per test: the place-order rate limit (5/min/IP) never trips across specs. */
function testIp() {
  return `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

/** Unique valid mobile number per test (coupon/abuse rules key on the phone). */
function testPhone() {
  return `09${[1, 3, 4, 6, 7, 8][randomInt(0, 6)]}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

for (const flow of flows) {
  test.describe(`checkout [${flow.locale}]`, () => {
    // Per-test email: cleanup finds the test's orders even when an assertion failed early.
    let email = '';
    const carts: string[] = [];

    test.beforeEach(async ({ context }) => {
      email = `e2e-${flow.locale}-${Date.now()}-${randomInt(0, 1_000_000)}@perfume.test`;
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
    });

    test.afterEach(async () => {
      await removeOrdersByEmail(email);
      for (const id of carts.splice(0)) await removeCart(id);
    });

    test('places a COD order and lands on the result page', async ({ page, context, baseURL }) => {
      const errors = collectConsoleErrors(page);
      const { cartId } = await seedCart(baseURL!, context, [{ sku: SKU.travel, quantity: 1 }]);
      carts.push(cartId);

      await page.goto(flow.checkout);
      await expect(page.getByRole('heading', { level: 1, name: flow.title })).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(flow.title));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      // Minimal checkout header: no storefront navigation.
      await expect(
        page.locator('header nav a[href*="nuoc-hoa"], header nav a[href*="perfumes"]'),
      ).toHaveCount(0);

      await fillCheckout(page, flow, testPhone(), email);
      await page.getByRole('radio', { name: flow.cod }).click();
      await acceptConsents(page, flow);
      await expect(page.getByTestId('deposit-notice')).toHaveCount(0);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      const total = await page.getByTestId('order-total').textContent();
      // The result page belongs to the payments stream: only this page's console is checked.
      expect(errors).toEqual([]);
      await page.getByRole('button', { name: flow.placeOrder, exact: true }).click();
      await page.waitForURL(flow.result);
      const code = flow.result.exec(page.url())![1]!;

      const order = await findOrder(code);
      expect(order).toMatchObject({
        status: 'awaiting_confirmation',
        payment_method: 'cod',
        locale: flow.locale,
        deposit_required: '0',
        email,
      });
      // 650,000 ₫ + 30,000 ₫ standard delivery, as displayed before placing the order.
      expect(order!.total).toBe('680000');
      expect(total?.replace(/\D/g, '')).toBe('680000');
    });

    test('places an online order (VietQR) and lands on the payment step', async ({
      page,
      context,
      baseURL,
    }) => {
      const { cartId } = await seedCart(baseURL!, context, [{ sku: SKU.travel, quantity: 2 }]);
      carts.push(cartId);

      await page.goto(flow.checkout);
      await fillCheckout(page, flow, testPhone(), email);
      await page.getByRole('radio', { name: flow.vietqr }).click();
      await acceptConsents(page, flow);
      await page.getByRole('button', { name: flow.placeOrderPay, exact: true }).click();
      await page.waitForURL(flow.result);
      const code = flow.result.exec(page.url())![1]!;

      expect(await findOrder(code)).toMatchObject({
        status: 'pending',
        payment_method: 'payos',
        locale: flow.locale,
        total: '1330000',
      });
    });

    test('asks a deposit for COD above the threshold', async ({ page, context, baseURL }) => {
      const { cartId } = await seedCart(baseURL!, context, [{ sku: SKU.parfum, quantity: 1 }]);
      carts.push(cartId);

      await page.goto(flow.checkout);
      await fillCheckout(page, flow, testPhone(), email);
      await page.getByRole('radio', { name: flow.cod }).click();
      await expect(page.getByTestId('deposit-notice')).toContainText(flow.deposit);
      await acceptConsents(page, flow);
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: flow.placeOrderPay, exact: true }).click();
      await page.waitForURL(flow.result);
      const code = flow.result.exec(page.url())![1]!;
      expect(await findOrder(code)).toMatchObject({
        status: 'pending',
        payment_method: 'cod',
        total: '5400000',
        deposit_required: '1080000',
      });
    });

    test('shows accessible validation errors', async ({ page, context, baseURL }) => {
      const errors = collectConsoleErrors(page);
      const { cartId } = await seedCart(baseURL!, context, [{ sku: SKU.travel, quantity: 1 }]);
      carts.push(cartId);

      await page.goto(flow.checkout);
      await page.getByRole('button', { name: flow.placeOrder, exact: true }).click();
      await expect(page.getByTestId('checkout-alert')).toContainText(flow.fixErrors);
      await expect(textbox(page, flow.labels.email)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByText(flow.required).first()).toBeVisible();
      await expect(page.getByText(flow.consentRequired).first()).toBeVisible();

      await textbox(page, flow.labels.phone).fill('0281234567');
      await textbox(page, flow.labels.phone).blur();
      await expect(page.getByText(flow.phoneInvalid)).toBeVisible();
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
      expect(page.url()).toContain(flow.checkout);
      expect(errors).toEqual([]);
    });

    test('sends shoppers without a cart back to the cart page', async ({ page }) => {
      await page.goto(flow.checkout);
      await page.waitForURL(flow.cart);
    });
  });
}
