import { test } from '@playwright/test';

import { checkPage, collectConsoleErrors, expect } from './helpers/purchase';

/*
 * Home discovery (§8.3, M3 wave 2): trust strip linking the policies, featured grid, new
 * arrivals and best sellers rails (each with a "view all" sorted listing), journal teaser
 * with the latest posts of the locale, newsletter sign-up. ADR-0021: under /en no rail shows
 * a product without a published English translation. 1280/768/375, axe, no console errors.
 */

const FLOWS = [
  {
    locale: 'vi',
    home: '/',
    newTitle: 'Hàng mới về',
    bestTitle: 'Bán chạy nhất',
    viewAllBest: 'Xem tất cả sản phẩm bán chạy',
    bestListing: /\/nuoc-hoa\?sort=best_selling$/,
    viewAllNew: 'Xem tất cả hàng mới',
    newListing: /\/nuoc-hoa\?sort=newest$/,
    journalTitle: 'Từ tạp chí',
    postPath: /^\/tap-chi\/[a-z0-9-]+$/,
    trust: {
      authentic: { link: 'Cam kết chính hãng', path: /\/cam-ket-chinh-hang$/ },
      returns: { link: 'Chính sách đổi trả', path: /\/chinh-sach\/doi-tra$/ },
      delivery: { link: 'Chính sách giao hàng', path: /\/chinh-sach\/giao-hang$/ },
    },
    newsletterTitle: 'Biết mùi hương mới trước tiên',
  },
  {
    locale: 'en',
    home: '/en',
    newTitle: 'New arrivals',
    bestTitle: 'Best sellers',
    viewAllBest: 'View all best sellers',
    bestListing: /\/en\/perfumes\?sort=best_selling$/,
    viewAllNew: 'View all new arrivals',
    newListing: /\/en\/perfumes\?sort=newest$/,
    journalTitle: 'From the journal',
    postPath: /^\/en\/journal\/[a-z0-9-]+$/,
    trust: {
      authentic: { link: 'Our authenticity promise', path: /\/en\/authenticity$/ },
      returns: { link: 'Returns policy', path: /\/en\/policies\/returns$/ },
      delivery: { link: 'Shipping policy', path: /\/en\/policies\/shipping$/ },
    },
    newsletterTitle: 'New scents, first',
  },
] as const;

for (const flow of FLOWS) {
  test.describe(`home (${flow.locale})`, () => {
    test('rails, trust strip, journal teaser and newsletter', async ({ page, isMobile }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(flow.home);
      await page.waitForLoadState('networkidle');

      const rails = { new: page.getByTestId('rail-new'), best: page.getByTestId('rail-best') };
      await expect(page.getByRole('heading', { level: 2, name: flow.newTitle })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: flow.bestTitle })).toBeVisible();
      for (const rail of Object.values(rails)) {
        expect(await rail.getByTestId('product-card').count()).toBeGreaterThan(0);
      }
      if (flow.locale === 'en') {
        // "Hoa Đêm EDP" has no published English translation (ADR-0021).
        await expect(page.getByTestId('product-card').filter({ hasText: 'Hoa Đêm' })).toHaveCount(
          0,
        );
      }

      for (const [key, item] of Object.entries(flow.trust)) {
        await expect(
          page.getByTestId(`trust-${key}`).getByRole('link', { name: item.link }),
        ).toBeVisible();
      }
      const journal = page.getByTestId('journal-teaser');
      await expect(
        journal.getByRole('heading', { level: 2, name: flow.journalTitle }),
      ).toBeVisible();
      const posts = journal.getByRole('article');
      expect(await posts.count()).toBeGreaterThan(0);
      expect(await posts.count()).toBeLessThanOrEqual(3);
      for (const href of await journal
        .getByRole('heading', { level: 3 })
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
        expect(href).toMatch(flow.postPath);
      }
      await expect(
        page.getByRole('heading', { level: 2, name: flow.newsletterTitle }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      await checkPage(page, isMobile);
      expect(errors).toEqual([]);
    });

    test('"view all" links open the sorted listings and trust links their pages', async ({
      page,
    }) => {
      await page.goto(flow.home);
      await page.getByRole('link', { name: flow.viewAllBest }).click();
      await expect(page).toHaveURL(flow.bestListing);
      await expect(page.getByTestId('product-card').first()).toBeVisible();

      await page.goto(flow.home);
      await page.getByRole('link', { name: flow.viewAllNew }).click();
      await expect(page).toHaveURL(flow.newListing);

      for (const [key, item] of Object.entries(flow.trust)) {
        await page.goto(flow.home);
        await page.getByTestId(`trust-${key}`).getByRole('link', { name: item.link }).click();
        await expect(page).toHaveURL(item.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    });
  });
}
