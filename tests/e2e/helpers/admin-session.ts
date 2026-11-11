import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

import { createStaffWithTotp, freshTotp, type StaffAccount } from './staff';

/*
 * Shared steps of the M2 admin specs (orders, coupons, shipping). Better Auth rate-limits
 * sign-up/sign-in per IP in production builds (5–10 per minute); when the whole admin suite
 * runs, these helpers wait out the window instead of failing.
 */

const RATE_LIMIT_WAIT_MS = 61_000;

/** Labelled control on the visible page (Next.js keeps hidden Activity routes mounted). */
export const field = (scope: Page | Locator, label: string) =>
  scope.getByLabel(label, { exact: true }).filter({ visible: true });

export const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    // Sonner dims stacked older toasts on purpose; the front toast is still checked.
    .exclude('[data-sonner-toast][data-front="false"]')
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // A rate-limited sign-in attempt (retried below) logs its 429 response.
    if (/status of 429/.test(message.text())) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function createStaff(
  baseURL: string,
  role: 'owner' | 'manager' | 'staff' | 'editor',
): Promise<StaffAccount> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await createStaffWithTotp(baseURL, role);
    } catch (error) {
      if (attempt >= 2 || !/HTTP 429/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    }
  }
}

/** UI sign-in (password + TOTP), retried once the rate-limit window has passed. */
export async function signInAdmin(page: Page, account: StaffAccount) {
  for (let attempt = 0; ; attempt += 1) {
    await page.goto('/admin/login');
    await field(page, 'Email').fill(account.email);
    await field(page, 'Mật khẩu').fill(account.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    const totp = field(page, 'Mã xác thực');
    const failed = page.getByText(/Email hoặc mật khẩu không đúng|Đã có lỗi xảy ra/);
    await expect(totp.or(failed)).toBeVisible({ timeout: 15_000 });
    if (await totp.isVisible()) {
      await totp.fill(await freshTotp(account.secret));
      await page.getByRole('button', { name: 'Xác nhận' }).click();
      const signedIn = await page
        .waitForURL(/\/admin$/, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (signedIn) return;
    }
    if (attempt >= 2) throw new Error('Admin sign-in kept failing (rate limit?)');
    await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
  }
}
