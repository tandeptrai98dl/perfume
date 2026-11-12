import { test } from '@playwright/test';

import {
  collectConsoleErrors as collectAdminConsoleErrors,
  createStaff,
  expectNoAxeViolations as expectNoAdminAxeViolations,
  field,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import {
  addToCartAndCheckout,
  cleanupPurchases,
  codeFromUrl,
  collectConsoleErrors,
  expect,
  fillCheckout,
  FLOWS,
  jobsForOrder,
  newShopper,
  orderByCode,
  placeOrderButton,
  reservationStates,
  standardShipping,
  type Shopper,
} from './helpers/purchase';
import type { StaffAccount } from './helpers/staff';

/*
 * End of the COD purchase (§3.4 step 5): a guest places a COD order through the storefront UI
 * (vi and en), staff find it in the admin "awaiting confirmation" queue with the right total
 * and confirm it; the stock reservation is committed and the guest's order view shows
 * "Confirmed". Admin targets ≥ 1024 px, so this runs in the desktop admin project only.
 */

test.describe.serial('admin: confirm a storefront COD order', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  let owner: StaffAccount;
  const shoppers: { shopper: Shopper; close: () => Promise<void> }[] = [];

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    owner = await createStaff(testInfo.project.use.baseURL!, 'owner');
  });

  test.afterAll(async () => {
    for (const { shopper, close } of shoppers.splice(0)) {
      await cleanupPurchases(shopper.email);
      await close();
    }
  });

  for (const flow of Object.values(FLOWS)) {
    test(`COD order placed in ${flow.locale} → staff confirm it`, async ({ browser, page }) => {
      test.setTimeout(240_000);
      const shopper = newShopper(flow.locale);
      const storefront = await browser.newContext({
        extraHTTPHeaders: { 'x-forwarded-for': shopper.ip },
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      });
      shoppers.push({ shopper, close: () => storefront.close() });
      const buyer = await storefront.newPage();
      const buyerErrors = collectConsoleErrors(buyer);

      const product = flow.products.cod;
      const total = product.price + standardShipping(product.price);
      await addToCartAndCheckout(buyer, flow, product);
      await fillCheckout(buyer, flow, { shopper, method: 'cod', total });
      await placeOrderButton(buyer, flow, false).click();
      await expect(buyer).toHaveURL(flow.resultPath);
      const code = codeFromUrl(buyer.url());
      const order = await orderByCode(code);
      expect(order.status).toBe('awaiting_confirmation');

      // Staff: awaiting-confirmation queue → search → detail → confirm.
      const errors = collectAdminConsoleErrors(page);
      await signInAdmin(page, owner);
      await page.goto('/admin/orders?tab=awaiting');
      await field(page, 'Tìm theo mã đơn, SĐT, email hoặc tên').fill(code);
      const row = page.getByRole('row').filter({ hasText: code });
      await expect(row).toContainText('Chờ xác nhận');
      await expect(row).toContainText(new RegExp(total.toLocaleString('en').replace(/,/g, '[.,]')));
      // The unfiltered queue may already show the row: wait for the debounced search to land in
      // the URL, then for the table to stop being dimmed (aria-busy) by the pending navigation.
      await expect(page).toHaveURL(new RegExp(`[?&]q=${code}`));
      await expect(page.locator('[aria-busy="true"]:has(> table)')).toHaveCount(0);
      await expect(page.getByRole('row')).toHaveCount(2);
      await expectNoAdminAxeViolations(page);
      await row.getByRole('link', { name: code }).click();
      await expect(page.getByRole('heading', { level: 1, name: code })).toBeVisible();
      await expect(page.getByText(shopper.name).first()).toBeVisible();
      await page.getByRole('button', { name: 'Xác nhận đơn', exact: true }).click();
      await expect(toast(page, `Đơn ${code}: Đã xác nhận`)).toBeVisible();
      await expectNoAdminAxeViolations(page);

      expect(await orderByCode(code)).toMatchObject({
        status: 'confirmed',
        payment_status: 'unpaid',
        total,
      });
      expect(await reservationStates(order.id)).toEqual(['committed']);
      expect(await jobsForOrder(order.id)).toEqual(
        expect.arrayContaining(['order.placed', 'order.status-changed']),
      );

      // The buyer sees the new status on their order view.
      await buyer.goto(`${flow.lookupPath}?code=${code}`);
      await expect(buyer.getByText(flow.order.status.confirmed).first()).toBeVisible();
      expect(buyerErrors).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
