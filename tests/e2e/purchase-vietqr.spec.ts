import { test } from '@playwright/test';

import { latestPayment, signedPayosWebhook } from './helpers/payment-orders';
import {
  addToCartAndCheckout,
  cartStatus,
  checkPage,
  cleanupPurchases,
  codeFromUrl,
  collectConsoleErrors,
  digits,
  expect,
  fillCheckout,
  FLOWS,
  jobsForOrder,
  newShopper,
  orderByCode,
  paymentEvents,
  placeOrderButton,
  PRODUCTS,
  reservationStates,
  summaryValue,
  type Shopper,
} from './helpers/purchase';

/*
 * Purchase with VietQR (payOS) through the real UI (M2 exit criteria, §3.4 steps 3–4, §10.4):
 * coupon WELCOME10 and express delivery at checkout → QR page with amount, transfer note and
 * countdown → the signed payOS webhook (simulator key) arrives → the page turns "Paid", the
 * order is confirmed, stock committed, the confirmation and payment e-mails are queued; a
 * replayed webhook changes nothing. vi and en, desktop (1280 + 768) and mobile (375).
 */

for (const flow of Object.values(FLOWS)) {
  test.describe(`purchase: VietQR (${flow.locale})`, () => {
    let shopper: Shopper;

    test.beforeEach(async ({ context }) => {
      shopper = newShopper(flow.locale);
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': shopper.ip });
    });

    test.afterEach(async ({ context }) => {
      await cleanupPurchases(shopper.email, context);
    });

    test('WELCOME10 + express → QR → webhook → paid and confirmed', async ({
      page,
      context,
      request,
      isMobile,
    }) => {
      test.setTimeout(120_000);
      const errors = collectConsoleErrors(page);
      const product = PRODUCTS.edt50;
      await addToCartAndCheckout(page, flow, product);

      // 2,300,000 ₫ − 200,000 ₫ (10% capped) + 50,000 ₫ express delivery.
      const discount = 200_000;
      const total = product.price - discount + 50_000;
      await fillCheckout(page, flow, {
        shopper,
        method: 'payos',
        shipping: 'express',
        coupon: 'WELCOME10',
        total,
      });
      await checkPage(page, isMobile);
      await placeOrderButton(page, flow, true).click();

      await expect(page).toHaveURL(flow.resultPath);
      const code = codeFromUrl(page.url());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.awaiting);
      await expect(page.getByRole('heading', { name: flow.result.qrHeading })).toBeVisible();
      await expect(page.getByRole('img', { name: /VietQR/ })).toBeVisible();
      await expect(page.getByTestId('qr-note')).toHaveText(code.replace(/-/g, ''));
      expect(digits(await page.getByTestId('qr-amount').textContent())).toBe(String(total));
      await expect(page.getByTestId('payment-countdown')).toHaveText(/^1[45]:\d\d$/);
      await checkPage(page, isMobile);

      const order = await orderByCode(code);
      expect(order).toMatchObject({
        status: 'pending',
        payment_status: 'unpaid',
        payment_method: 'payos',
        locale: flow.locale,
        subtotal: product.price,
        discount_total: discount,
        shipping_fee: 50_000,
        total,
        coupon_code: 'WELCOME10',
      });
      expect(await reservationStates(order.id)).toEqual(['active']);
      expect(await cartStatus(context)).toBe('converted');

      const payment = await latestPayment(order.id);
      expect(payment).toMatchObject({ provider: 'payos', status: 'pending', amount: total });
      const body = signedPayosWebhook(payment!.txn_ref, payment!.amount);
      expect((await request.post('/api/webhooks/payos', { data: body })).ok()).toBe(true);
      // A replay is acknowledged and changes nothing.
      expect((await request.post('/api/webhooks/payos', { data: body })).ok()).toBe(true);

      // 3-second polling turns the page into "Paid".
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.paid, {
        timeout: 20_000,
      });
      expect(await orderByCode(code)).toMatchObject({
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: total,
      });
      expect(await reservationStates(order.id)).toEqual(['committed']);
      const ledger = await paymentEvents(order.id);
      expect(ledger.payments).toEqual([{ provider: 'payos', status: 'succeeded', amount: total }]);
      expect(await jobsForOrder(order.id)).toEqual(
        expect.arrayContaining(['order.placed', 'payment.received', 'order.status-changed']),
      );
      expect((await jobsForOrder(order.id)).filter((n) => n === 'payment.received')).toHaveLength(
        1,
      );
      await checkPage(page, isMobile);

      // Order view: confirmed, paid in full, coupon on the summary.
      await page.goto(`${flow.lookupPath}?code=${code}`);
      await expect(
        page.getByRole('heading', { level: 1, name: flow.order.title(code) }),
      ).toBeVisible();
      await expect(page.getByText(flow.order.status.confirmed).first()).toBeVisible();
      await expect(page.getByText('WELCOME10').first()).toBeVisible();
      expect(digits(await summaryValue(page, flow.order.total).textContent())).toBe(String(total));
      expect(digits(await summaryValue(page, flow.order.paid).textContent())).toBe(String(total));
      expect(digits(await summaryValue(page, flow.order.due).textContent())).toBe('0');
      await expect(page.getByTestId('header-cart-count')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
