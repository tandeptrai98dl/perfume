import { test } from '@playwright/test';

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
 * Purchase with VNPay through the real UI (M2 exit criteria, §3.4 steps 3–4, §10.4): "Place
 * order and pay" goes straight to the gateway (the sandbox simulator page, which sends the
 * signed IPN like VNPay's server and redirects back) → the return URL shows the result page.
 * The order changes only through the IPN: it is recorded in `payment_events`, and the same
 * return URL replayed later changes nothing. vi and en, desktop (1280 + 768) and mobile (375).
 */

const SIMULATOR = /\/api\/payments\/simulator\/vnpay\?/;

for (const flow of Object.values(FLOWS)) {
  test.describe(`purchase: VNPay (${flow.locale})`, () => {
    let shopper: Shopper;

    test.beforeEach(async ({ context }) => {
      shopper = newShopper(flow.locale);
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': shopper.ip });
    });

    test.afterEach(async ({ context }) => {
      await cleanupPurchases(shopper.email, context);
    });

    test('redirect to VNPay → IPN → return URL shows paid', async ({ page, context, isMobile }) => {
      test.setTimeout(120_000);
      const errors = collectConsoleErrors(page);
      const product = PRODUCTS.edt100;
      await addToCartAndCheckout(page, flow, product);

      // 3,200,000 ₫, standard delivery free from 2,000,000 ₫.
      const total = product.price;
      await fillCheckout(page, flow, { shopper, method: 'vnpay', total });
      await checkPage(page, isMobile);

      const gateway = page.waitForRequest(SIMULATOR);
      await placeOrderButton(page, flow, true).click();
      const gatewayUrl = new URL((await gateway).url());
      // Signed VNPay payment URL with the full amount (×100) and the localized return URL.
      expect(gatewayUrl.searchParams.get('vnp_Amount')).toBe(String(total * 100));
      expect(gatewayUrl.searchParams.get('vnp_Locale')).toBe(flow.locale === 'en' ? 'en' : 'vn');
      const returnUrl = new URL(gatewayUrl.searchParams.get('vnp_ReturnUrl')!);
      expect(returnUrl.pathname).toBe(
        flow.locale === 'en' ? '/en/checkout/result' : '/thanh-toan/ket-qua',
      );

      await expect(page).toHaveURL(/vnp_ResponseCode=00/);
      await expect(page).toHaveURL(flow.resultPath);
      const code = codeFromUrl(page.url());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.paid);
      await expect(page.getByTestId('order-code')).toHaveText(code);
      await checkPage(page, isMobile);

      const order = await orderByCode(code);
      expect(order).toMatchObject({
        status: 'confirmed',
        payment_status: 'paid',
        payment_method: 'vnpay',
        locale: flow.locale,
        total,
        amount_paid: total,
      });
      expect(await reservationStates(order.id)).toEqual(['committed']);
      const ledger = await paymentEvents(order.id);
      expect(ledger.payments).toEqual([{ provider: 'vnpay', status: 'succeeded', amount: total }]);
      // The IPN is the event that changed the state (the return URL records nothing).
      expect(ledger.events).toBe(1);
      expect(await cartStatus(context)).toBe('converted');
      const jobs = await jobsForOrder(order.id);
      expect(jobs).toEqual(
        expect.arrayContaining(['order.placed', 'payment.received', 'order.status-changed']),
      );

      // Reloading the signed return URL only displays the state again.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(flow.result.paid);
      expect((await paymentEvents(order.id)).events).toBe(1);
      expect((await jobsForOrder(order.id)).length).toBe(jobs.length);

      // Order view: confirmed and paid in full.
      await page.goto(`${flow.lookupPath}?code=${code}`);
      await expect(
        page.getByRole('heading', { level: 1, name: flow.order.title(code) }),
      ).toBeVisible();
      await expect(page.getByText(flow.order.status.confirmed).first()).toBeVisible();
      expect(digits(await summaryValue(page, flow.order.total).textContent())).toBe(String(total));
      expect(digits(await summaryValue(page, flow.order.due).textContent())).toBe('0');
      expect(errors).toEqual([]);
    });
  });
}
