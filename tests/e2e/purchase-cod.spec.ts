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
  placeOrderButton,
  reservationStates,
  standardShipping,
  summaryValue,
  type Shopper,
} from './helpers/purchase';

/*
 * Purchase with cash on delivery through the real UI (M2 exit criteria, §3.4 step 5, D16):
 *  - below the threshold: the order waits for staff confirmation (24 h reservation), the guest
 *    can look it up by code + phone;
 *  - above 5,000,000 ₫: a 20% deposit is paid online (VietQR, signed simulator webhook) and the
 *    order is confirmed with the balance due on delivery.
 * vi and en, desktop (1280 + 768) and mobile (375).
 */

for (const flow of Object.values(FLOWS)) {
  test.describe(`purchase: COD (${flow.locale})`, () => {
    let shopper: Shopper;

    test.beforeEach(async ({ context }) => {
      shopper = newShopper(flow.locale);
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': shopper.ip });
    });

    test.afterEach(async ({ context }) => {
      await cleanupPurchases(shopper.email, context);
    });

    test('COD below the threshold → awaiting confirmation → guest lookup', async ({
      page,
      context,
      browser,
      isMobile,
    }) => {
      test.setTimeout(120_000);
      const errors = collectConsoleErrors(page);
      const product = flow.products.cod;
      await addToCartAndCheckout(page, flow, product);

      const shippingFee = standardShipping(product.price);
      const total = product.price + shippingFee;
      await fillCheckout(page, flow, { shopper, method: 'cod', total });
      await checkPage(page, isMobile);
      await placeOrderButton(page, flow, false).click();

      await expect(page).toHaveURL(flow.resultPath);
      const code = codeFromUrl(page.url());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.codConfirm);
      await expect(page.getByTestId('order-code')).toHaveText(code);
      await checkPage(page, isMobile);

      const order = await orderByCode(code);
      expect(order).toMatchObject({
        status: 'awaiting_confirmation',
        payment_status: 'unpaid',
        payment_method: 'cod',
        locale: flow.locale,
        source: 'web',
        subtotal: product.price,
        shipping_fee: shippingFee,
        total,
        deposit_required: 0,
        amount_paid: 0,
      });
      expect(await reservationStates(order.id)).toEqual(['active']);
      expect(await jobsForOrder(order.id)).toContain('order.placed');
      expect(await cartStatus(context)).toBe('converted');

      // The cart is empty once the order is placed.
      await page.getByRole('link', { name: flow.result.continueShopping }).click();
      await expect(page.getByTestId('header-cart-count')).toHaveCount(0);

      // Guest lookup from another browser: code + phone → read-only order view.
      const guest = await browser.newContext({
        extraHTTPHeaders: { 'x-forwarded-for': newShopper(flow.locale).ip },
        ...(isMobile ? { viewport: { width: 375, height: 812 }, isMobile: true } : {}),
      });
      const lookup = await guest.newPage();
      const lookupErrors = collectConsoleErrors(lookup);
      await lookup.goto(flow.lookupPath);
      await lookup.getByLabel(flow.order.lookupCode).fill(code.toLowerCase());
      await lookup.getByLabel(flow.order.lookupPhone).fill(shopper.phone);
      await lookup.getByRole('button', { name: flow.order.lookupSubmit }).click();
      await expect(
        lookup.getByRole('heading', { level: 1, name: flow.order.title(code) }),
      ).toBeVisible();
      await expect(lookup.getByText(flow.order.status.awaiting_confirmation).first()).toBeVisible();
      expect(digits(await summaryValue(lookup, flow.order.total).textContent())).toBe(
        String(total),
      );
      expect(digits(await summaryValue(lookup, flow.order.due).textContent())).toBe(String(total));
      await checkPage(lookup, isMobile);
      expect(lookupErrors).toEqual([]);
      await guest.close();

      expect(errors).toEqual([]);
    });

    test('COD above the threshold → deposit by VietQR → confirmed, balance on delivery', async ({
      page,
      request,
      isMobile,
    }) => {
      test.setTimeout(120_000);
      const errors = collectConsoleErrors(page);
      const product = flow.products.deposit;
      await addToCartAndCheckout(page, flow, product, 2);

      // Two units over 5,000,000 ₫, standard delivery free; 20% deposit.
      const total = product.price * 2;
      const deposit = total / 5;
      await fillCheckout(page, flow, { shopper, method: 'cod', total, deposit });
      await checkPage(page, isMobile);
      await placeOrderButton(page, flow, true).click();

      await expect(page).toHaveURL(flow.resultPath);
      const code = codeFromUrl(page.url());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.depositRequired);
      await expect(page.getByRole('heading', { name: flow.result.qrHeading })).toBeVisible();
      expect(digits(await page.getByTestId('qr-amount').textContent())).toBe(String(deposit));
      await checkPage(page, isMobile);

      const order = await orderByCode(code);
      expect(order).toMatchObject({
        status: 'pending',
        payment_method: 'cod',
        total,
        deposit_required: deposit,
      });

      const payment = await latestPayment(order.id);
      expect(payment).toMatchObject({ provider: 'payos', status: 'pending', amount: deposit });
      const webhook = await request.post('/api/webhooks/payos', {
        data: signedPayosWebhook(payment!.txn_ref, payment!.amount),
      });
      expect(webhook.ok()).toBe(true);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.depositPaid);
      expect(await orderByCode(code)).toMatchObject({
        status: 'confirmed',
        payment_status: 'partially_paid',
        amount_paid: deposit,
      });
      expect(await reservationStates(order.id)).toEqual(['committed']);
      expect(await jobsForOrder(order.id)).toEqual(
        expect.arrayContaining(['order.placed', 'payment.received', 'order.status-changed']),
      );
      await checkPage(page, isMobile);

      // Order view (this browser holds the access cookie): deposit paid, balance due.
      await page.goto(`${flow.lookupPath}?code=${code}`);
      await expect(
        page.getByRole('heading', { level: 1, name: flow.order.title(code) }),
      ).toBeVisible();
      await expect(page.getByText(flow.order.paymentStatus.partially_paid).first()).toBeVisible();
      expect(digits(await summaryValue(page, flow.order.paid).textContent())).toBe(String(deposit));
      expect(digits(await summaryValue(page, flow.order.due).textContent())).toBe(
        String(total - deposit),
      );
      expect(errors).toEqual([]);
    });
  });
}
