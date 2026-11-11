import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { parseServerEnv } from '@/lib/env';
import { createAuth } from '@/server/auth/config';
import { createDb } from '@/server/db/client';
import { users } from '@/server/db/schema';

import { totp } from '../integration/helpers/totp';

/*
 * Admin content screens end to end (desktop only: admin targets ≥ 1024 px). Creates a fresh
 * editor account in the E2E database, enrols TOTP through the real UI, then edits content and
 * checks the storefront. Everything it creates is deleted again.
 */

const PASSWORD = 'e2e-editor-password-1234';
const run = Date.now().toString(36);
const email = `editor-${run}@example.com`;

// One long journey (sign-in + TOTP enrolment + several saves).
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  const env = parseServerEnv(process.env);
  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const { user } = await createAuth(db, env).api.signUpEmail({
      body: { email, name: 'E2E Editor', password: PASSWORD },
    });
    await db
      .update(users)
      .set({ role: 'editor', emailVerified: true })
      .where(eq(users.id, user.id));
  } finally {
    await pool.end();
  }
});

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/two-factor$/);
  await page.getByLabel('Nhập lại mật khẩu để tiếp tục').fill(PASSWORD);
  await page.getByRole('button', { name: 'Tạo mã thiết lập' }).click();
  const secret = (await page.locator('code').first().textContent())!.trim();
  await page.getByLabel('Mã 6 số từ ứng dụng').fill(totp(secret));
  await page.getByRole('button', { name: 'Xác nhận và bật' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test('editor manages content from the admin screens', async ({ page, request }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await signIn(page);

  await page.goto('/admin/content');
  await expect(page.getByRole('heading', { level: 1, name: 'Nội dung' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // Create and publish a Vietnamese policy page with the rich text editor.
  await page.goto('/admin/content/pages/new');
  await page.getByLabel('Mã trang').fill(`e2e-${run}`);
  await page.getByLabel('Trạng thái').selectOption('active');
  const viPanel = page.getByRole('tabpanel', { name: 'Tiếng Việt' });
  await viPanel.getByLabel('Tiêu đề', { exact: true }).fill(`Trang thử ${run}`);
  await viPanel.getByLabel('Tiêu đề', { exact: true }).blur();
  await expect(viPanel.getByLabel('Đường dẫn (slug)')).toHaveValue(`trang-thu-${run}`);
  const editor = viPanel.getByRole('textbox', { name: 'Nội dung' });
  await editor.click();
  await page.keyboard.type('Nội dung kiểm thử ');
  await viPanel.getByRole('button', { name: 'In đậm' }).click();
  await page.keyboard.type('quan trọng');
  await viPanel.getByLabel('Xuất bản bản tiếng Việt').check();
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page).toHaveURL(/\/admin\/content\/pages\/[0-9a-f-]{36}$/);
  const editUrl = page.url();

  await page.goto(`/chinh-sach/trang-thu-${run}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Trang thử ${run}`);
  await expect(page.locator('strong', { hasText: 'quan trọng' })).toBeVisible();
  // English was never written: hidden on /en.
  expect(
    (await request.get(`/en/policies/trang-thu-${run}`, { maxRedirects: 0 })).status(),
  ).not.toBe(200);

  // Changing a published slug inserts a 301 automatically.
  await page.goto(editUrl);
  // Wait for hydration: typing into server-rendered inputs before React attaches is lost.
  await page.waitForLoadState('networkidle');
  const slugField = page
    .getByRole('tabpanel', { name: 'Tiếng Việt' })
    .getByLabel('Đường dẫn (slug)');
  await expect(slugField).toHaveValue(`trang-thu-${run}`);
  await slugField.fill(`trang-moi-${run}`);
  await expect(slugField).toHaveValue(`trang-moi-${run}`);
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Đã lưu')).toBeVisible();
  const moved = await request.get(`/chinh-sach/trang-thu-${run}`, { maxRedirects: 0 });
  expect(moved.status()).toBe(301);
  expect(moved.headers()['location']).toMatch(new RegExp(`/chinh-sach/trang-moi-${run}$`));

  // Manual redirect: create, follow, delete.
  await page.goto('/admin/content/redirects');
  await page.getByLabel('Đường dẫn cũ').fill(`/tap-chi/e2e-${run}`);
  await page.getByLabel('Đường dẫn mới').fill('/tap-chi/edt-hay-edp');
  await page.getByRole('button', { name: 'Thêm chuyển hướng' }).click();
  const row = page.getByRole('row', { name: new RegExp(`/tap-chi/e2e-${run}`) });
  await expect(row).toBeVisible();
  const manual = await request.get(`/tap-chi/e2e-${run}`, { maxRedirects: 0 });
  expect(manual.status()).toBe(301);
  await row.getByRole('button', { name: 'Xoá' }).click();
  await expect(row).toHaveCount(0);

  // Clean up: the page, then the redirect its slug change created.
  await page.goto('/admin/content/pages');
  await page.getByRole('link', { name: `Trang thử ${run}` }).click();
  await page.getByRole('button', { name: 'Xoá' }).click();
  await expect(page).toHaveURL(/\/admin\/content\/pages$/);
  await page.goto(`/admin/content/redirects?q=${encodeURIComponent(`trang-thu-${run}`)}`);
  const slugRedirect = page.getByRole('row', { name: new RegExp(`trang-thu-${run}`) });
  await slugRedirect.getByRole('button', { name: 'Xoá' }).click();
  await expect(slugRedirect).toHaveCount(0);

  // Banner editor preview and menu builder load (nothing saved).
  await page.goto('/admin/content/banners/new');
  await page
    .getByRole('tabpanel', { name: 'Tiếng Việt' })
    .getByLabel('Tiêu đề')
    .fill('Banner xem trước');
  const preview = page.getByRole('region', { name: 'Xem trước' });
  await expect(preview.getByText('Banner xem trước')).toBeVisible();
  await preview.getByRole('button', { name: 'Điện thoại' }).click();
  await expect(preview.getByRole('button', { name: 'Điện thoại' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/admin/content/navigation/footer');
  await expect(page.getByRole('textbox', { name: 'Tên (VI) 1' })).toHaveValue('Về chúng tôi');
});
