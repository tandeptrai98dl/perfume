import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('storefront shell', () => {
  test('Vietnamese home at / with lang="vi"', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Hương thơm dành riêng cho bạn',
    );
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('English home at /en with lang="en"', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('language switcher keeps the page and switches locale', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('link', { name: 'Tiếng Việt' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  });

  test('has no horizontal overflow', async ({ page }) => {
    for (const path of ['/', '/en']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('skip link is the first focusable element', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Bỏ qua đến nội dung chính' })).toBeFocused();
  });

  test('unknown pages return 404', async ({ page }) => {
    const response = await page.goto('/khong-ton-tai');
    expect(response?.status()).toBe(404);
  });
});

test.describe('admin', () => {
  test('redirects anonymous visitors to the login page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('rejects wrong credentials with a generic message', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Mật khẩu').fill('wrong-password');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Email hoặc mật khẩu không đúng.' }),
    ).toBeVisible();
  });
});
