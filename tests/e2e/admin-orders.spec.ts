import { expect as baseExpect, test } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin as signIn,
  toast,
} from './helpers/admin-session';
import { createE2EOrder, deleteE2EOrders, type E2EOrder } from './helpers/orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Admin orders (M2 admin stream, §11 target: confirm → pack → tracking in under 2 minutes).
 * Orders are inserted directly (no stock reservation) with "E2E Admin <run>" names and deleted
 * afterwards. Admin targets ≥ 1024 px, so this runs in the desktop admin project only.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

test.describe.serial('admin orders', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36).toUpperCase();
  const customer = `E2E Admin ${run}`;
  const created: E2EOrder[] = [];
  let owner: StaffAccount;
  let staff: StaffAccount;

  async function order(input: Omit<Parameters<typeof createE2EOrder>[0], 'customerName'> = {}) {
    const row = await createE2EOrder({ customerName: customer, ...input });
    created.push(row);
    return row;
  }

  test.beforeAll(async ({}, testInfo) => {
    // Account creation may wait out the auth rate limit (see helpers/admin-session.ts).
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL!;
    owner = await createStaff(baseURL, 'owner');
    staff = await createStaff(baseURL, 'staff');
  });

  test.afterAll(async () => {
    await deleteE2EOrders(created);
  });

  test('owner confirms, packs and ships a COD order in under two minutes', async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectConsoleErrors(page);
    const cod = await order();
    const bulk = await order();
    const gift = await order({ hidePrices: true, giftMessage: 'Chúc mừng sinh nhật!' });
    await signIn(page, owner);

    // Dashboard: work queues, and revenue for the owner (M3 KPI dashboard).
    await expect(page.getByRole('heading', { name: 'Đơn cần xử lý' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Doanh thu thuần theo ngày' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Orders list → "awaiting confirmation" queue → search by code.
    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Danh sách đơn', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Đơn hàng' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Hàng đợi xử lý' })
      .getByRole('link', { name: /Chờ xác nhận/ })
      .click();
    await expect(page).toHaveURL(/tab=awaiting/);
    await field(page, 'Tìm theo mã đơn, SĐT, email hoặc tên').fill(cod.code);
    const row = page.getByRole('row').filter({ hasText: cod.code });
    await expect(row).toContainText('Chờ xác nhận');
    await expect(page.getByRole('row')).toHaveCount(2);
    await expectNoAxeViolations(page);

    const started = Date.now();
    await row.getByRole('link', { name: cod.code }).click();
    await expect(page.getByRole('heading', { level: 1, name: cod.code })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Xác nhận đơn', exact: true }).click();
    await expect(toast(page, `Đơn ${cod.code}: Đã xác nhận`)).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu đóng gói' }).click();
    await expect(toast(page, `Đơn ${cod.code}: Đang đóng gói`)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Hãng vận chuyển' })).toContainText('GHN');
    await field(page, 'Mã vận đơn').fill(`ghn${run}`);
    await page.getByRole('button', { name: 'Xác nhận đã gửi hàng' }).click();
    await expect(toast(page, `Đơn ${cod.code}: Đang giao`)).toBeVisible();
    expect(Date.now() - started).toBeLessThan(120_000);

    const shipments = page.getByRole('table', { name: 'Vận đơn' });
    await expect(shipments).toContainText(`GHN${run}`);
    await expect(page.getByRole('button', { name: 'Đã giao thành công' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Internal note on the timeline.
    await field(page, 'Thêm ghi chú nội bộ').fill('Khách hẹn giao giờ hành chính');
    await page.getByRole('button', { name: 'Lưu ghi chú' }).click();
    await expect(toast(page, 'Đã lưu ghi chú')).toBeVisible();
    await expect(page.getByText('Khách hẹn giao giờ hành chính')).toBeVisible();

    // Delivery slip: print page without admin chrome, COD amount and tracking code.
    await page.goto(`/admin/orders/${cod.id}/print/delivery-slip`);
    await expect(page.getByRole('heading', { level: 1, name: /Phiếu giao hàng/ })).toBeVisible();
    await expect(page.getByText(`GHN · GHN${run}`)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Gift order: packing slip shows the message and no prices.
    await page.goto(`/admin/orders/${gift.id}/print/packing-slip`);
    await expect(page.getByText('Chúc mừng sinh nhật!')).toBeVisible();
    await expect(page.getByText('Đơn quà tặng: phiếu không in giá.')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Đơn giá' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Bulk confirm from the list.
    await page.goto(`/admin/orders?tab=awaiting&q=${encodeURIComponent(bulk.code)}`);
    await page
      .getByRole('row')
      .filter({ hasText: bulk.code })
      .getByRole('checkbox', { name: 'Chọn dòng' })
      .click();
    await page
      .getByRole('region', { name: 'Thao tác hàng loạt' })
      .getByRole('button', { name: 'Xác nhận đơn COD' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận 1 đơn đã chọn?' });
    await dialog.getByRole('button', { name: 'Xác nhận đơn COD' }).click();
    await expect(toast(page, 'Đã xác nhận 1 đơn')).toBeVisible();
    await page.goto(`/admin/orders?q=${encodeURIComponent(bulk.code)}`);
    await expect(page.getByRole('row').filter({ hasText: bulk.code })).toContainText('Đã xác nhận');

    expect(errors).toEqual([]);
  });

  test('deposit guard and manager-only cancellation', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectConsoleErrors(page);
    const deposit = await order({ depositRequired: 1_000_000 });
    const confirmed = await order({ status: 'confirmed' });

    // Staff: cannot cancel a confirmed order, no coupon/shipping management.
    await signIn(page, staff);
    const nav = page.getByRole('navigation', { name: 'Điều hướng quản trị' });
    await expect(nav.getByRole('link', { name: 'Danh sách đơn', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Mã giảm giá', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Doanh thu/ })).toHaveCount(0);
    await page.goto(`/admin/orders/${confirmed.id}`);
    await expect(page.getByRole('heading', { level: 1, name: confirmed.code })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bắt đầu đóng gói' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Huỷ đơn' })).toHaveCount(0);
    await expect(
      page.getByText('Chỉ Quản lý hoặc Chủ shop được huỷ đơn đã xác nhận hoặc đã nhận tiền.'),
    ).toBeVisible();

    // Deposit not paid yet: confirmation is blocked.
    await page.goto(`/admin/orders/${deposit.id}`);
    await expect(page.getByText(/cần nhận đủ tiền cọc 1\.000\.000/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận đơn', exact: true })).toBeDisabled();
    await expectNoAxeViolations(page);

    // Owner cancels the confirmed order with a reason.
    await page.context().clearCookies();
    await signIn(page, owner);
    await page.goto(`/admin/orders/${confirmed.id}`);
    await page.getByRole('button', { name: 'Huỷ đơn' }).click();
    const dialog = page.getByRole('dialog', { name: `Huỷ đơn ${confirmed.code}?` });
    await expectNoAxeViolations(page);
    await field(dialog, 'Lý do huỷ').fill('Khách đổi ý qua điện thoại');
    await dialog.getByRole('button', { name: 'Huỷ đơn' }).click();
    await expect(toast(page, `Đơn ${confirmed.code}: Đã huỷ`)).toBeVisible();
    await expect(page.getByText('Không còn thao tác nào cho trạng thái này.')).toBeVisible();
    await expect(page.getByText('Khách đổi ý qua điện thoại')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
