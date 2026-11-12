import { randomBytes } from 'node:crypto';

import { expect as baseExpect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import { withDb } from './helpers/payment-orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Admin settings (M3 wave 2, desktop): the Owner edits the seller information and the MOIT
 * badge, then the storefront footer shows them in vi and en; checkout/COD and VAT sections
 * validate on the server and are audited; a Manager has no access. Original rows are restored
 * afterwards so other specs keep the seed values.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

/** 1×1 transparent PNG served for the official badge host (no network in E2E). */
const BADGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const BADGE_URL = 'https://online.gov.vn/Content/EndUser/LogoCCDVSaleNoti/logoSaleNoti.png';
const MOIT_URL = 'http://online.gov.vn/Home/WebDetails/123456';

type SettingRow = { key: string; value: unknown };

async function snapshotSettings(): Promise<SettingRow[]> {
  return withDb(async (db) => (await db.query<SettingRow>('select key, value from settings')).rows);
}

async function restoreSettings(rows: SettingRow[]) {
  await withDb(async (db) => {
    await db.query('begin');
    await db.query('delete from settings');
    for (const row of rows) {
      await db.query('insert into settings (key, value) values ($1, $2::jsonb)', [
        row.key,
        JSON.stringify(row.value),
      ]);
    }
    await db.query('commit');
  });
}

async function storedValue(key: string): Promise<unknown> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ value: unknown }>(
      'select value from settings where key = $1',
      [key],
    );
    return rows[0]?.value ?? null;
  });
}

async function openSettings(page: Page) {
  await page
    .getByRole('navigation', { name: 'Điều hướng quản trị' })
    .getByRole('link', { name: 'Cài đặt', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
}

/** The footer cache is revalidated stale-while-revalidate: reload until the new block shows. */
async function expectFooterSeller(page: Page, path: string, texts: string[], badge: string) {
  await expect(async () => {
    await page.goto(path);
    const seller = page.getByRole('region', { name: /Thông tin người bán|Seller information/ });
    for (const text of texts) await baseExpect(seller).toContainText(text, { timeout: 1000 });
    const link = seller.getByTestId('moit-badge');
    await baseExpect(link).toHaveAttribute('href', MOIT_URL, { timeout: 1000 });
    await baseExpect(link.getByRole('img', { name: badge })).toHaveAttribute('src', BADGE_URL, {
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });
}

test.describe.serial('admin settings', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = randomBytes(3).toString('hex');
  const company = {
    name: `Công ty TNHH Hương Thơm E2E ${run}`,
    taxCode: '0312345678',
    address: `12 Lê Lợi ${run}, Quận 1, TP. Hồ Chí Minh`,
    phone: '19001234',
  };
  let owner: StaffAccount;
  let manager: StaffAccount;
  let original: SettingRow[] = [];

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    original = await snapshotSettings();
    owner = await createStaff(testInfo.project.use.baseURL!, 'owner');
    manager = await createStaff(testInfo.project.use.baseURL!, 'manager');
  });

  test.afterAll(async () => {
    await restoreSettings(original);
  });

  test.beforeEach(async ({ page }) => {
    await page.route('https://online.gov.vn/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: BADGE_PNG }),
    );
  });

  test('owner saves seller info and the MOIT badge; the footer shows them in vi and en', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);
    await openSettings(page);
    await expect(page.getByRole('tab', { name: 'Người bán', selected: true })).toBeVisible();
    await expectNoAxeViolations(page);

    const form = page.getByRole('form', { name: 'Thông tin người bán' });
    await field(form, 'Tên doanh nghiệp').fill(company.name);
    await field(form, 'Mã số thuế').fill('12345');
    await field(form, 'Địa chỉ trụ sở').fill(company.address);
    await field(form, 'Hotline').fill(company.phone);
    await field(form, 'Đường dẫn hồ sơ trên online.gov.vn').fill('https://example.com/fake');
    await field(form, 'Ảnh logo đã thông báo').fill(BADGE_URL);
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(form.getByText('Mã số thuế gồm 10 chữ số')).toBeVisible();
    await expect(
      form.getByText('Dán đường dẫn hồ sơ của website trên online.gov.vn.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await field(form, 'Mã số thuế').fill(company.taxCode);
    await field(form, 'Đường dẫn hồ sơ trên online.gov.vn').fill(MOIT_URL);
    await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(toast(page, 'Đã lưu cài đặt')).toBeVisible();
    // Digit-only hotline is stored as a string.
    expect(await storedValue('company.phone')).toBe(company.phone);

    await expectFooterSeller(
      page,
      '/',
      [company.name, `Mã số thuế: ${company.taxCode}`, `Điện thoại: ${company.phone}`],
      'Đã thông báo Bộ Công Thương',
    );
    await expectNoAxeViolations(page);
    await expectFooterSeller(
      page,
      '/en',
      [company.name, `Tax code: ${company.taxCode}`, `Phone: ${company.phone}`],
      'Notified to the Ministry of Industry and Trade',
    );
    expect(errors).toEqual([]);
  });

  test('checkout and VAT sections validate, warn and are audited', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);
    await openSettings(page);

    // Keyboard: arrow keys move between tabs (Radix roving focus), Enter/Space not needed.
    await page.getByRole('tab', { name: 'Người bán' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Thanh toán & COD', selected: true })).toBeFocused();

    const checkout = page.getByRole('form', { name: 'Thanh toán, COD và giữ hàng' });
    await expect(page.getByText(/ảnh hưởng ngay đến giá và điều kiện thanh toán/)).toBeVisible();
    await field(checkout, 'Phiên thanh toán (phút)').fill('40');
    await field(checkout, 'Giữ hàng cho đơn online (phút)').fill('20');
    await field(checkout, 'Phí gói quà (VND)').fill('30000');
    await checkout.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(
      checkout.getByText('Thời gian giữ hàng phải dài hơn hoặc bằng phiên thanh toán.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await field(checkout, 'Phiên thanh toán (phút)').fill('15');
    await field(checkout, 'Giữ hàng cho đơn online (phút)').fill('30');
    await checkout.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(toast(page, 'Đã lưu cài đặt')).toBeVisible();
    expect(await storedValue('giftWrap.fee')).toBe(30_000);

    await page.getByRole('tab', { name: 'Hoá đơn điện tử' }).click();
    const einvoice = page.getByRole('form', { name: 'Hoá đơn điện tử' });
    await expect(page.getByText(/Chờ kế toán xác nhận/)).toBeVisible();
    await einvoice.getByLabel('Thuế suất GTGT', { exact: true }).click();
    await page.getByRole('option', { name: '8 %' }).click();
    await einvoice.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(toast(page, 'Đã lưu cài đặt')).toBeVisible();
    expect(await storedValue('einvoice.vatRatePercent')).toBe(8);
    await expectNoAxeViolations(page);

    const audited = await withDb(async (db) => {
      const { rows } = await db.query<{ entity_id: string }>(
        `select entity_id from audit_logs where action = 'settings.update' and actor_id = (
           select id from users where email = $1) order by created_at`,
        [owner.email],
      );
      return rows.map((row) => row.entity_id);
    });
    expect(audited).toEqual(expect.arrayContaining(['company', 'checkout', 'einvoice']));
    expect(errors).toEqual([]);
  });

  test('a manager has no access to settings', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAdmin(page, manager);
    await expect(
      page
        .getByRole('navigation', { name: 'Điều hướng quản trị' })
        .getByRole('link', { name: 'Cài đặt', exact: true }),
    ).toHaveCount(0);
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
  });
});
