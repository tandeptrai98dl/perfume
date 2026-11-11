import { createHash, randomInt } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, type BrowserContext, type Page } from '@playwright/test';

import { cleanupOrders, withDb } from './payment-orders';

/*
 * Full purchase flow through the real storefront UI (M2 exit criterion: all three payment
 * methods in vi and en): product page → add to cart → mini-cart → cart page → checkout (guest,
 * province/ward address, delivery option, optional coupon) → place order → result page →
 * guest order view. Only payments are driven from outside the browser: the payOS webhook is
 * signed with the public simulator key, VNPay goes through the built-in gateway simulator.
 * Every test uses its own email, phone and client IP; `cleanupPurchases` removes its orders,
 * gives the stock back (reserved or committed) and drops the carts the browser created.
 */

export const expect = baseExpect.configure({ timeout: 15_000 });

/*
 * Demo seed products. "Atelier Sương Hoa Đêm" has no published English translation (it is
 * absent under /en, ADR-0021), so English flows use the Maison Lumière line. Each flow spreads
 * its orders over variants so parallel runs (desktop + mobile) never exhaust a variant's stock.
 */
export const PRODUCTS = {
  /** 650,000 ₫ travel spray (vi only). */
  travel: { slug: 'atelier-suong-hoa-dem-edp', sku: 'ATEL-HOA--EDP-10', price: 650_000 },
  /** 2,750,000 ₫ (vi only). */
  fullSize: { slug: 'atelier-suong-hoa-dem-edp', sku: 'ATEL-HOA--EDP-75', price: 2_750_000 },
  /** 2,300,000 ₫. */
  edt50: { slug: 'maison-lumiere-cedre-nocturne-edt', sku: 'MAIS-CEDR-EDT-50', price: 2_300_000 },
  /** 3,200,000 ₫. */
  edt100: {
    slug: 'maison-lumiere-cedre-nocturne-edt',
    sku: 'MAIS-CEDR-EDT-100',
    price: 3_200_000,
  },
} as const;

export type Product = (typeof PRODUCTS)[keyof typeof PRODUCTS];

/** Standard delivery: 30,000 ₫, free from 2,000,000 ₫ of merchandise (seed rates). */
export const standardShipping = (merchandise: number) => (merchandise >= 2_000_000 ? 0 : 30_000);

export const FLOWS = {
  vi: {
    locale: 'vi' as const,
    /** COD below the threshold; two of `deposit` push COD over 5,000,000 ₫. */
    products: { cod: PRODUCTS.travel, deposit: PRODUCTS.fullSize },
    pdp: (slug: string) => `/san-pham/${slug}`,
    cartPath: /\/gio-hang$/,
    checkoutPath: /\/thanh-toan$/,
    resultPath: /\/thanh-toan\/ket-qua\?/,
    lookupPath: '/tra-cuu-don-hang',
    add: 'Thêm vào giỏ',
    miniTitle: 'Giỏ hàng của bạn',
    increase: 'Tăng số lượng',
    viewCart: 'Xem giỏ hàng',
    cartHeading: 'Giỏ hàng',
    toCheckout: 'Thanh toán',
    checkoutHeading: 'Thanh toán',
    labels: {
      email: 'Email',
      phone: 'Số điện thoại di động',
      fullName: 'Họ và tên',
      province: 'Tỉnh / thành phố',
      ward: 'Phường / xã',
      street: 'Địa chỉ cụ thể',
      coupon: 'Mã giảm giá',
    },
    provinceSearch: 'ho chi minh',
    provinceOption: 'Thành phố Hồ Chí Minh',
    wardSearch: 'ben thanh',
    wardOption: 'Phường Bến Thành',
    shipping: { standard: /Giao tiêu chuẩn/, express: /Giao nhanh/ },
    methods: {
      cod: /Thanh toán khi nhận hàng/,
      payos: /Chuyển khoản qua VietQR/,
      vnpay: /^VNPay/,
    },
    applyCoupon: 'Áp dụng',
    couponApplied: 'Đã áp dụng mã WELCOME10',
    terms: /Điều khoản mua hàng/,
    privacy: /Chính sách bảo mật/,
    placeOrder: 'Đặt hàng',
    placeOrderPay: 'Đặt hàng và thanh toán',
    deposit: 'Đơn COD này cần đặt cọc',
    result: {
      codConfirm: 'Đặt hàng thành công',
      awaiting: 'Hoàn tất thanh toán',
      depositRequired: 'Thanh toán tiền đặt cọc',
      depositPaid: 'Đã nhận tiền đặt cọc',
      paid: 'Thanh toán thành công',
      qrHeading: 'Quét mã VietQR để thanh toán',
      continueShopping: 'Tiếp tục mua sắm',
    },
    order: {
      title: (code: string) => `Đơn hàng ${code}`,
      total: 'Tổng cộng',
      paid: 'Đã thanh toán',
      due: 'Còn lại',
      deposit: 'Tiền đặt cọc',
      status: {
        awaiting_confirmation: 'Chờ xác nhận',
        pending: 'Chờ thanh toán',
        confirmed: 'Đã xác nhận',
      },
      paymentStatus: {
        unpaid: 'Chưa thanh toán',
        partially_paid: 'Đã thanh toán một phần',
        paid: 'Đã thanh toán',
      },
      lookupCode: 'Mã đơn hàng',
      lookupPhone: 'Số điện thoại',
      lookupSubmit: 'Tra cứu',
    },
    emptyCart: 'Giỏ hàng đang trống',
  },
  en: {
    locale: 'en' as const,
    products: { cod: PRODUCTS.edt50, deposit: PRODUCTS.edt100 },
    pdp: (slug: string) => `/en/products/${slug}`,
    cartPath: /\/en\/cart$/,
    checkoutPath: /\/en\/checkout$/,
    resultPath: /\/en\/checkout\/result\?/,
    lookupPath: '/en/order-lookup',
    add: 'Add to cart',
    miniTitle: 'Your cart',
    increase: 'Increase quantity',
    viewCart: 'View cart',
    cartHeading: 'Cart',
    toCheckout: 'Checkout',
    checkoutHeading: 'Checkout',
    labels: {
      email: 'Email',
      phone: 'Mobile number',
      fullName: 'Full name',
      province: 'Province / city',
      ward: 'Ward / commune',
      street: 'Street address',
      coupon: 'Discount code',
    },
    // English shows names without diacritics; search accepts the Vietnamese spelling too.
    provinceSearch: 'Hồ Chí Minh',
    provinceOption: 'Thanh pho Ho Chi Minh',
    wardSearch: 'Bến Thành',
    wardOption: 'Phuong Ben Thanh',
    shipping: { standard: /Standard delivery/, express: /Express delivery/ },
    methods: {
      cod: /Cash on delivery/,
      payos: /Bank transfer by VietQR/,
      vnpay: /^VNPay/,
    },
    applyCoupon: 'Apply',
    couponApplied: 'Code WELCOME10 applied',
    terms: /Terms of sale/,
    privacy: /Privacy policy/,
    placeOrder: 'Place order',
    placeOrderPay: 'Place order and pay',
    deposit: 'A deposit is required for this COD order',
    result: {
      codConfirm: 'Order placed',
      awaiting: 'Complete your payment',
      depositRequired: 'Pay your deposit',
      depositPaid: 'Deposit received',
      paid: 'Payment received',
      qrHeading: 'Scan the VietQR code to pay',
      continueShopping: 'Continue shopping',
    },
    order: {
      title: (code: string) => `Order ${code}`,
      total: 'Total',
      paid: 'Paid',
      due: 'Remaining',
      deposit: 'Deposit required',
      status: {
        awaiting_confirmation: 'Awaiting confirmation',
        pending: 'Awaiting payment',
        confirmed: 'Confirmed',
      },
      paymentStatus: { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid' },
      lookupCode: 'Order code',
      lookupPhone: 'Phone number',
      lookupSubmit: 'Find order',
    },
    emptyCart: 'Your cart is empty',
  },
} as const;

export type Flow = (typeof FLOWS)[keyof typeof FLOWS];
export type Method = keyof Flow['methods'];

/** "6.400.000 ₫" (vi) and "₫6,400,000" (en): compare digits only. */
export const digits = (text: string | null) => (text ?? '').replace(/\D/g, '');

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    // Sonner dims stacked older toasts on purpose; the front toast is still checked.
    .exclude('[data-sonner-toast][data-front="false"]')
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    page.url(),
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
}

/**
 * Accessibility and layout at the project's viewport; on desktop also at the 768 px tablet
 * width (the mobile project covers 375 px).
 */
export async function checkPage(page: Page, isMobile: boolean) {
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  if (isMobile) return;
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.setViewportSize(size);
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export type Shopper = { email: string; phone: string; ip: string; name: string };

/** Unique email, phone (coupon limits key on it) and client IP (place-order 5/min/IP). */
export function newShopper(locale: string): Shopper {
  const prefix = [1, 3, 4, 6, 7, 8][randomInt(0, 6)];
  return {
    email: `e2e-purchase-${locale}-${Date.now()}-${randomInt(0, 1_000_000)}@perfume.test`,
    phone: `09${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
    ip: `203.0.${randomInt(0, 255)}.${randomInt(1, 254)}`,
    name: 'Trần Thị Mua Hàng',
  };
}

/**
 * Product page → add to cart → mini-cart (optionally raise the quantity) → cart page →
 * checkout. Returns the cart subtotal shown on the cart page.
 */
export async function addToCartAndCheckout(
  page: Page,
  flow: Flow,
  product: Product,
  quantity = 1,
): Promise<void> {
  await page.goto(`${flow.pdp(product.slug)}?v=${encodeURIComponent(product.sku)}`);
  // Let streamed boundaries hydrate first: the modal sheet hides its siblings (aria-hidden).
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: flow.add }).click();

  const sheet = page.getByRole('dialog', { name: flow.miniTitle });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('cart-line')).toHaveCount(1);
  for (let n = 1; n < quantity; n += 1) {
    await sheet.getByRole('button', { name: flow.increase }).click();
    await expect(page.getByTestId('header-cart-count')).toHaveText(String(n + 1));
  }
  await expect(page.getByTestId('header-cart-count')).toHaveText(String(quantity));
  await expect
    .poll(async () => digits(await sheet.getByTestId('mini-cart-subtotal').textContent()))
    .toBe(String(product.price * quantity));

  await sheet.getByRole('link', { name: flow.viewCart }).click();
  await expect(page).toHaveURL(flow.cartPath);
  await expect(page.getByRole('heading', { level: 1, name: flow.cartHeading })).toBeVisible();
  const summary = page.getByTestId('cart-summary');
  await expect
    .poll(async () => digits(await summary.getByTestId('cart-subtotal').textContent()))
    .toBe(String(product.price * quantity));

  await summary.getByRole('link', { name: flow.toCheckout }).click();
  await expect(page).toHaveURL(flow.checkoutPath);
  await expect(page.getByRole('heading', { level: 1, name: flow.checkoutHeading })).toBeVisible();
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

export type CheckoutChoices = {
  shopper: Shopper;
  shipping?: 'standard' | 'express';
  method: Method;
  coupon?: string;
  /** Expected total before placing (digits), when the test knows it. */
  total: number;
  deposit?: number;
};

/** Fills the guest checkout, checks the summary and returns the displayed total. */
export async function fillCheckout(page: Page, flow: Flow, choices: CheckoutChoices) {
  const { shopper } = choices;
  await textbox(page, flow.labels.email).fill(shopper.email);
  await textbox(page, flow.labels.phone).fill(shopper.phone);
  await textbox(page, flow.labels.fullName).fill(shopper.name);
  await pick(page, flow.labels.province, flow.provinceSearch, flow.provinceOption);
  await pick(page, flow.labels.ward, flow.wardSearch, flow.wardOption);
  await textbox(page, flow.labels.street).fill('12 Lê Lợi');

  const shipping = page.getByRole('radio', { name: flow.shipping[choices.shipping ?? 'standard'] });
  await shipping.click();
  await expect(shipping).toBeChecked();
  const method = page.getByRole('radio', { name: flow.methods[choices.method] });
  await method.click();
  await expect(method).toBeChecked();

  if (choices.coupon) {
    await textbox(page, flow.labels.coupon).fill(choices.coupon.toLowerCase());
    await page.getByRole('button', { name: flow.applyCoupon, exact: true }).click();
    await expect(page.getByText(flow.couponApplied)).toBeVisible();
  }
  if (choices.deposit) {
    await expect(page.getByTestId('deposit-notice')).toContainText(flow.deposit);
  } else {
    await expect(page.getByTestId('deposit-notice')).toHaveCount(0);
  }

  await page.getByRole('checkbox', { name: flow.terms }).click();
  await page.getByRole('checkbox', { name: flow.privacy }).click();
  await expect
    .poll(async () => digits(await page.getByTestId('order-total').textContent()))
    .toBe(String(choices.total));
}

export function placeOrderButton(page: Page, flow: Flow, paysOnline: boolean) {
  return page.getByRole('button', {
    name: paysOnline ? flow.placeOrderPay : flow.placeOrder,
    exact: true,
  });
}

/** Order code from the result page URL (`?code=PF-…`). */
export function codeFromUrl(url: string): string {
  const code = new URL(url).searchParams.getAll('code').find((v) => /^PF-/.test(v));
  if (!code) throw new Error(`No order code in ${url}`);
  return code;
}

/** Value of a summary row (`<dt>label</dt><dd>value</dd>`) on the order view. */
export function summaryValue(page: Page, label: string) {
  return page
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]');
}

// ---------------------------------------------------------------- database checks

export type OrderRow = {
  id: string;
  code: string;
  status: string;
  payment_status: string;
  payment_method: string;
  locale: string;
  total: number;
  subtotal: number;
  discount_total: number;
  shipping_fee: number;
  deposit_required: number;
  amount_paid: number;
  coupon_code: string | null;
  email: string;
  source: string;
};

export async function orderByCode(code: string): Promise<OrderRow> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `select id, code, status, payment_status, payment_method, locale, total::int, subtotal::int,
         discount_total::int, shipping_fee::int, deposit_required::int, amount_paid::int,
         coupon_code, email, source
       from orders where code = $1`,
      [code],
    );
    if (!rows[0]) throw new Error(`Order ${code} not found`);
    return rows[0] as OrderRow;
  });
}

/** Reservation states of the order, e.g. `['active']` or `['committed']`. */
export async function reservationStates(orderId: string): Promise<string[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ status: string }>(
      'select status from stock_reservations where order_id = $1 order by status',
      [orderId],
    );
    return rows.map((row) => row.status);
  });
}

/** Outbox jobs enqueued for the order (pg-boss), e.g. `order.placed`, `payment.received`. */
export async function jobsForOrder(orderId: string): Promise<string[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ name: string }>(
      `select name from pgboss.job where data->>'orderId' = $1 order by created_on`,
      [orderId],
    );
    return rows.map((row) => row.name);
  });
}

/** Gateway notifications recorded for the order (`payment_events.source`/`type`). */
export async function paymentEvents(orderId: string) {
  return withDb(async (db) => {
    const { rows } = await db.query<{ provider: string; status: string; amount: number }>(
      `select p.provider, p.status, p.amount::int as amount from payments p
       where p.order_id = $1 order by p.created_at`,
      [orderId],
    );
    const events = await db.query<{ count: number }>(
      `select count(*)::int as count from payment_events e join payments p on p.id = e.payment_id
       where p.order_id = $1`,
      [orderId],
    );
    return { payments: rows, events: events.rows[0]!.count };
  });
}

function cartTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function cartToken(context: BrowserContext): Promise<string | null> {
  const cookie = (await context.cookies()).find((c) => c.name === 'cart_token');
  return cookie?.value ?? null;
}

/** Status of the browser's cart (`converted` once the order is placed). */
export async function cartStatus(context: BrowserContext): Promise<string | null> {
  const token = await cartToken(context);
  if (!token) return null;
  return withDb(async (db) => {
    const { rows } = await db.query<{ status: string }>(
      'select status from carts where token_hash = $1',
      [cartTokenHash(token)],
    );
    return rows[0]?.status ?? null;
  });
}

/**
 * Removes the shopper's orders (stock back, coupon count back, payments, consents) and the
 * browser's cart. Safe to call after a failed assertion.
 */
export async function cleanupPurchases(email: string, context?: BrowserContext): Promise<void> {
  const ids = await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>('select id from orders where email = $1', [
      email,
    ]);
    const orderIds = rows.map((row) => row.id);
    if (orderIds.length > 0) {
      await db.query(
        `update coupons c set used_count = greatest(0, c.used_count - r.n)
         from (select coupon_id, count(*)::int as n from coupon_redemptions
               where order_id = any($1) group by coupon_id) r
         where c.id = r.coupon_id`,
        [orderIds],
      );
      await db.query('delete from coupon_redemptions where order_id = any($1)', [orderIds]);
      await db.query('delete from refunds where order_id = any($1)', [orderIds]);
    }
    await db.query('delete from consents where email = $1', [email]);
    return orderIds;
  });
  await cleanupOrders(ids);
  const token = context ? await cartToken(context) : null;
  if (token) {
    await withDb((db) =>
      db.query('delete from carts where token_hash = $1', [cartTokenHash(token)]),
    );
  }
}
