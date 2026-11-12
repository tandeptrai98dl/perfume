import { test } from '@playwright/test';

import {
  checkPage,
  cleanupPurchases,
  collectConsoleErrors,
  expect,
  FLOWS,
  newShopper,
} from './helpers/purchase';

/*
 * Accessibility gate (§16.2 "axe accessibility on 5 key pages × 2 locales"), consolidated:
 * home, listing, product, cart and checkout (with a line in the cart) in vi and en, axe
 * WCAG 2.2 AA + no horizontal overflow at 1280 and 768 (desktop project) and 375 (mobile
 * project), no console errors. Feature specs keep their own page-level checks.
 */

const PAGES = {
  vi: {
    home: '/',
    listing: '/nuoc-hoa',
    pdp: `${FLOWS.vi.pdp('atelier-suong-hoa-dem-edp')}?v=ATEL-HOA--EDP-75`,
  },
  en: {
    home: '/en',
    listing: '/en/perfumes',
    pdp: `${FLOWS.en.pdp('maison-lumiere-cedre-nocturne-edt')}?v=MAIS-CEDR-EDT-100`,
  },
} as const;

for (const flow of Object.values(FLOWS)) {
  const paths = PAGES[flow.locale];

  test(`key pages are accessible (${flow.locale})`, async ({ page, context, isMobile }) => {
    test.setTimeout(150_000);
    const shopper = newShopper(flow.locale);
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': shopper.ip });
    const errors = collectConsoleErrors(page);
    try {
      for (const path of [paths.home, paths.listing]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await checkPage(page, isMobile);
      }

      await page.goto(paths.pdp);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await checkPage(page, isMobile);
      await page.getByRole('button', { name: flow.add }).click();
      const sheet = page.getByRole('dialog', { name: flow.miniTitle });
      await expect(sheet.getByTestId('cart-line')).toHaveCount(1);
      // The open mini-cart (modal sheet) is a key state too.
      await checkPage(page, true);
      await sheet.getByRole('link', { name: flow.viewCart }).click();

      await expect(page).toHaveURL(flow.cartPath);
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await checkPage(page, isMobile);

      await page.getByTestId('cart-summary').getByRole('link', { name: flow.toCheckout }).click();
      await expect(page).toHaveURL(flow.checkoutPath);
      await page.waitForLoadState('networkidle');
      await expect(
        page.getByRole('heading', { level: 1, name: flow.checkoutHeading }),
      ).toBeVisible();
      await checkPage(page, isMobile);
      expect(errors).toEqual([]);
    } finally {
      await cleanupPurchases(shopper.email, context);
    }
  });
}
