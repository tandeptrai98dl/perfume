import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';

import {
  cleanupOrders,
  createTestOrder,
  latestPayment,
  orderState,
  signedPayosWebhook,
  withDb,
} from './helpers/orders';

/*
 * Checkout result page (§10.4, ADR-0006) in vi and en: VietQR panel with amount, transfer
 * note and countdown that turns into "Paid" when a signed payOS webhook arrives; VNPay
 * redirect through the sandbox simulator; the return URL alone never changes state; retry
 * after an expired session; guests without access see nothing. Orders are inserted directly
 * (the checkout form is another stream). Needs DATABASE_URL and PAYMENT_SIMULATOR=true.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

const COPY = {
  vi: {
    path: '/thanh-toan/ket-qua',
    awaiting: 'Hoàn tất thanh toán',
    paid: 'Thanh toán thành công',
    qrHeading: 'Quét mã VietQR để thanh toán',
    vnpayPay: /Thanh toán .* với VNPay/,
    expired: 'Phiên thanh toán đã hết hạn',
    retry: 'Thanh toán lại',
    vietqr: 'Chuyển khoản VietQR',
    notFound: 'Không tìm thấy đơn hàng',
    returned: 'Đã quay lại từ VNPay',
    codTitle: 'Đặt hàng thành công',
  },
  en: {
    path: '/en/checkout/result',
    awaiting: 'Complete your payment',
    paid: 'Payment received',
    qrHeading: 'Scan the VietQR code to pay',
    vnpayPay: /Pay .* with VNPay/,
    expired: 'Payment session expired',
    retry: 'Pay again',
    vietqr: 'VietQR bank transfer',
    notFound: 'Order not found',
    returned: 'Back from VNPay',
    codTitle: 'Order placed',
  },
} as const;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('[data-sonner-toast][data-front="false"]')
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

const created: string[] = [];
test.afterAll(async () => {
  await cleanupOrders(created.splice(0));
});

for (const locale of ['vi', 'en'] as const) {
  const copy = COPY[locale];
  const url = (code: string, token?: string) =>
    `${copy.path}?code=${code}${token ? `&t=${token}` : ''}`;

  test.describe(`checkout result (${locale})`, () => {
    test('VietQR: QR, amount, note and countdown, then "Paid" after the signed webhook', async ({
      page,
      request,
    }) => {
      const errors = collectConsoleErrors(page);
      const order = await createTestOrder({ method: 'payos', reservationMinutes: 30, locale });
      created.push(order.id);

      await page.goto(url(order.code, order.token));
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.awaiting);
      await expect(page.getByRole('heading', { name: copy.qrHeading })).toBeVisible();
      await expect(page.getByRole('img', { name: /VietQR/ })).toBeVisible();
      await expect(page.getByTestId('qr-note')).toHaveText(order.code.replace(/-/g, ''));
      await expect(page.getByTestId('qr-amount')).toContainText(/1[.,]450[.,]000/);
      await expect(page.getByTestId('payment-countdown')).toHaveText(/^1[45]:\d\d$/);
      await expect(page.getByTestId('payment-sandbox')).toBeVisible();
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const payment = await latestPayment(order.id);
      expect(payment).toMatchObject({ provider: 'payos', status: 'pending', amount: order.total });
      const body = signedPayosWebhook(payment!.txn_ref, payment!.amount);
      const response = await request.post('/api/webhooks/payos', { data: body });
      expect(response.ok()).toBe(true);
      // A replay is acknowledged and changes nothing.
      expect((await request.post('/api/webhooks/payos', { data: body })).ok()).toBe(true);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.paid);
      expect(await orderState(order.id)).toMatchObject({
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: String(order.total),
      });
      await expectNoAxeViolations(page);
      expect(errors).toEqual([]);
    });

    test('VNPay: redirect to the gateway and back; status comes from the IPN', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const order = await createTestOrder({ method: 'vnpay', reservationMinutes: 30, locale });
      created.push(order.id);

      await page.goto(url(order.code, order.token));
      const pay = page.getByRole('link', { name: copy.vnpayPay });
      await expect(pay).toBeVisible();
      await expectNoAxeViolations(page);
      await pay.click();
      await expect(page).toHaveURL(/vnp_ResponseCode=00/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.paid);
      expect((await orderState(order.id)).payment_status).toBe('paid');
      expect(errors).toEqual([]);
    });

    test('a forged return URL only displays status', async ({ page }) => {
      const order = await createTestOrder({ method: 'vnpay', reservationMinutes: 30, locale });
      created.push(order.id);
      await page.goto(url(order.code, order.token));
      const payment = await latestPayment(order.id);
      await page.goto(
        `${url(order.code, order.token)}&vnp_ResponseCode=00&vnp_TransactionStatus=00&vnp_TxnRef=${payment!.txn_ref}&vnp_Amount=${order.total * 100}&vnp_SecureHash=forged`,
      );
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.awaiting);
      await expect(page.getByText(copy.returned)).toBeVisible();
      expect(await orderState(order.id)).toMatchObject({
        status: 'pending',
        payment_status: 'unpaid',
      });
    });

    test('expired session: retry while stock is held, switching to VietQR', async ({ page }) => {
      const order = await createTestOrder({ method: 'vnpay', reservationMinutes: 30, locale });
      created.push(order.id);
      await page.goto(url(order.code, order.token));
      await expect(page.getByRole('link', { name: copy.vnpayPay })).toBeVisible();
      await withDb((db) =>
        db.query(
          `update payments set expires_at = now() - interval '1 minute' where order_id = $1`,
          [order.id],
        ),
      );
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.expired);
      await page.getByRole('radio', { name: new RegExp(copy.vietqr) }).click();
      await page.getByRole('button', { name: copy.retry }).click();
      await expect(page.getByRole('heading', { name: copy.qrHeading })).toBeVisible();
      await expect(page.getByTestId('payment-countdown')).toBeVisible();
      expect(await latestPayment(order.id)).toMatchObject({ provider: 'payos', status: 'pending' });
    });

    test('COD without deposit: "we will call to confirm"; no access without token', async ({
      page,
      browser,
    }) => {
      const order = await createTestOrder({ method: 'cod', reservationMinutes: 24 * 60, locale });
      created.push(order.id);
      await page.goto(url(order.code, order.token));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.codTitle);
      await expectNoAxeViolations(page);

      const stranger = await browser.newPage();
      await stranger.goto(url(order.code));
      await expect(stranger.getByRole('heading', { level: 1 })).toHaveText(copy.notFound);
      await stranger.close();
    });
  });
}
