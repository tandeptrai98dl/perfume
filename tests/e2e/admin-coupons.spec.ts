import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';

import { deleteE2EPromotions } from './helpers/orders';
import { createStaffWithTotp, freshTotp, type StaffAccount } from './helpers/staff';

/*
 * Coupons and shipping zones (M2 admin stream). Data is uniquely named (E2E prefix) and removed
 * afterwards; the test zone has a low priority, so storefront quotes keep using the seed zone.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('[data-sonner-toast][data-front="false"]')
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

const field = (scope: Page | Locator, label: string) =>
  scope.getByLabel(label, { exact: true }).filter({ visible: true });

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

async function signIn(page: Page, account: StaffAccount) {
  await page.goto('/admin/login');
  await field(page, 'Email').fill(account.email);
  await field(page, 'Mật khẩu').fill(account.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await field(page, 'Mã xác thực').fill(await freshTotp(account.secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.serial('admin coupons and shipping', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36).toUpperCase();
  const prefix = `E2E${run}`;
  let owner: StaffAccount;

  test.beforeAll(async ({}, testInfo) => {
    owner = await createStaffWithTotp(testInfo.project.use.baseURL!, 'owner');
  });

  test.afterAll(async () => {
    await deleteE2EPromotions(prefix);
  });

  test('owner creates, edits and switches off a coupon', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    const code = `${prefix}-TET`;
    await signIn(page, owner);

    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Mã giảm giá', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mã giảm giá' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'Tạo mã giảm giá' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tạo mã giảm giá' })).toBeVisible();
    await field(page, 'Mã giảm giá').fill(code.toLowerCase());
    await field(page, 'Giá trị').fill('150');
    await field(page, 'Giảm tối đa (₫)').fill('200000');
    await field(page, 'Giá trị đơn tối thiểu (₫)').fill('1000000');
    await field(page, 'Số lượt mỗi khách').fill('1');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Tạo', exact: true }).click();
    // 150% is refused with a translated field error.
    await expect(page.getByText('Phần trăm từ 1 đến 100.')).toBeVisible();
    await field(page, 'Giá trị').fill('15');
    await page.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(toast(page, 'Đã tạo')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/promotions\/coupons\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: code })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thống kê sử dụng' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Edit: switch to a fixed amount.
    await page.getByRole('combobox', { name: 'Loại giảm giá', exact: true }).click();
    await page.getByRole('option', { name: 'Số tiền cố định', exact: true }).click();
    await field(page, 'Giá trị').fill('100000');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(toast(page, 'Đã lưu thay đổi')).toBeVisible();

    // List: usage stats and the on/off switch.
    await page.goto(`/admin/promotions/coupons?q=${encodeURIComponent(code)}`);
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('Số tiền cố định');
    await expect(row).toContainText('100.000');
    await expect(row).toContainText('Đang chạy');
    await row.getByRole('switch', { name: `Đang bật mã ${code}` }).click();
    await expect(toast(page, `Đã tắt mã ${code}`)).toBeVisible();
    await expect(row).toContainText('Đã tắt');
    await expectNoAxeViolations(page);

    expect(errors).toEqual([]);
  });

  test('owner manages a shipping zone and its rates', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    const zoneName = `${prefix} Miền Tây`;
    await signIn(page, owner);
    await page.goto('/admin/shipping');
    await expect(page.getByRole('heading', { level: 1, name: 'Vận chuyển' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Thêm khu vực' }).click();
    const zoneDialog = page.getByRole('dialog', { name: 'Thêm khu vực' });
    await field(zoneDialog, 'Tên khu vực (nội bộ)').fill(zoneName);
    await field(zoneDialog, 'Thứ tự ưu tiên').fill('999');
    await zoneDialog.getByRole('checkbox', { name: 'Thành phố Cần Thơ' }).click();
    await expectNoAxeViolations(page);
    await zoneDialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(toast(page, 'Đã lưu khu vực')).toBeVisible();

    const zone = page.getByRole('region', { name: zoneName });
    await expect(zone).toContainText('1 tỉnh/thành');
    await zone.getByRole('button', { name: `Thêm mức phí cho ${zoneName}` }).click();
    const rateDialog = page.getByRole('dialog', { name: 'Thêm mức phí' });
    await field(rateDialog, 'Tên hiển thị (tiếng Việt)').fill('Giao tiết kiệm');
    await field(rateDialog, 'Tên hiển thị (tiếng Anh)').fill('Economy delivery');
    await field(rateDialog, 'Đến (gram)').fill('2000');
    await field(rateDialog, 'Phí (₫)').fill('25000');
    await field(rateDialog, 'Nhanh nhất (ngày)').fill('3');
    await field(rateDialog, 'Chậm nhất (ngày)').fill('2');
    await rateDialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(
      rateDialog.getByText('Số ngày chậm nhất phải lớn hơn hoặc bằng số ngày nhanh nhất.'),
    ).toBeVisible();
    await field(rateDialog, 'Chậm nhất (ngày)').fill('5');
    await rateDialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(toast(page, 'Đã lưu mức phí')).toBeVisible();

    const rateRow = zone.getByRole('row').filter({ hasText: 'Giao tiết kiệm' });
    await expect(rateRow).toContainText('25.000');
    await expect(rateRow).toContainText('0–2000 g');
    await rateRow.getByRole('switch', { name: 'Áp dụng mức phí Giao tiết kiệm' }).click();
    await expect(toast(page, 'Đã tắt mức phí')).toBeVisible();
    await expectNoAxeViolations(page);

    await zone.getByRole('button', { name: 'Xoá khu vực' }).click();
    const confirm = page.getByRole('dialog', { name: `Xoá khu vực ${zoneName}?` });
    await field(confirm, `Nhập “${zoneName}” để xác nhận`).fill(zoneName);
    await confirm.getByRole('button', { name: 'Xoá khu vực' }).click();
    await expect(toast(page, 'Đã xoá khu vực')).toBeVisible();
    await expect(page.getByRole('region', { name: zoneName })).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
