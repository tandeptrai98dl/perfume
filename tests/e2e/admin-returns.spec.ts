import { expect as baseExpect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  signInAdmin as signIn,
  toast,
} from './helpers/admin-session';
import {
  deleteReturnOrders,
  insertReturnOrder,
  insertReturnRequest,
  orderState,
  type ReturnOrder,
} from './helpers/returns';
import type { StaffAccount } from './helpers/staff';

/*
 * Admin returns (ADR-0017) and e-invoice adjustments: the return queue, approve → goods
 * received (write-off, refund queued, invoice cancellation queued), reject with a reason,
 * and "Lập hoá đơn thay thế" on the e-invoice panel. The worker does not run during E2E: the
 * spec checks the queued jobs and what staff see. Desktop admin only (≥ 1024 px).
 */

const expect = baseExpect.configure({ timeout: 15_000 });

const vnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)}`;

async function returnSection(page: Page) {
  const section = page.getByRole('region', { name: 'Đổi trả' });
  await expect(section).toBeVisible();
  return section;
}

test.describe.serial('admin returns', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const ids: string[] = [];
  let manager: StaffAccount;
  let staff: StaffAccount;
  let full: ReturnOrder;
  let rejected: ReturnOrder;
  let invoiced: ReturnOrder;
  let rejectedRequest: string;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL!;
    manager = await createStaff(baseURL, 'manager');
    staff = await createStaff(baseURL, 'staff');
    const email = (name: string) => `e2e-return-${name}-${Date.now()}@perfume.test`;
    full = await insertReturnOrder({ locale: 'vi', email: email('full'), einvoice: true });
    rejected = await insertReturnOrder({ locale: 'en', email: email('reject') });
    invoiced = await insertReturnOrder({ locale: 'vi', email: email('invoice'), einvoice: true });
    ids.push(full.id, rejected.id, invoiced.id);
    await insertReturnRequest(full, {
      reason: 'defective',
      quantity: 2,
      description: 'Vòi xịt bị kẹt, không xịt được.',
    });
    rejectedRequest = await insertReturnRequest(rejected, {
      reason: 'unopened',
      quantity: 1,
      description: 'Changed my mind',
    });
  });

  test.afterAll(async () => {
    await deleteReturnOrders(ids);
  });

  test('queue, approve and receive a defective return', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, manager);

    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Yêu cầu đổi trả', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Yêu cầu đổi trả' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: full.code });
    await expect(row).toContainText('Chờ duyệt');
    await expect(row).toContainText('Sản phẩm lỗi');
    await expect(row).toContainText(vnd(full.total));
    await expect(page.getByRole('row').filter({ hasText: rejected.code })).toContainText(
      'Đổi ý (còn seal)',
    );
    await expect(page.getByRole('row').filter({ hasText: invoiced.code })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await row.getByRole('link', { name: full.code }).click();
    const section = await returnSection(page);
    await expect(section).toContainText('Vòi xịt bị kẹt, không xịt được.');
    await expect(section).toContainText('trả 2/2');
    // The generic status buttons never close a return.
    await expect(
      page.getByRole('region', { name: 'Xử lý đơn' }).getByRole('button', { name: /hoàn hàng/i }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);

    await section.getByRole('button', { name: 'Chấp nhận' }).click();
    const approve = page.getByRole('dialog', {
      name: `Chấp nhận yêu cầu trả hàng đơn ${full.code}?`,
    });
    await approve.getByLabel(/Hướng dẫn gửi khách/).fill('GHN sẽ lấy hàng tại địa chỉ giao.');
    await expectNoAxeViolations(page);
    await approve.getByRole('button', { name: 'Chấp nhận' }).click();
    await expect(toast(page, `Đã chấp nhận yêu cầu trả hàng đơn ${full.code}.`)).toBeVisible();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'approved');

    await section.getByRole('button', { name: 'Đã nhận lại hàng' }).click();
    const receive = page.getByRole('dialog', {
      name: `Xác nhận đã nhận hàng trả của đơn ${full.code}?`,
    });
    // Defective goods are not sellable by default.
    await expect(
      receive.getByRole('checkbox', { name: 'Hàng còn nguyên seal, nhập lại kho bán' }),
    ).not.toBeChecked();
    await receive.getByLabel('Phí gửi trả khách đã trả (₫)').fill('30000');
    await expect(receive).toContainText(vnd(full.total + 30_000));
    await expectNoAxeViolations(page);
    // Keyboard: submit from the last field with Enter on the confirm button.
    await receive.getByRole('button', { name: 'Xác nhận đã nhận hàng' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, `Đã ghi nhận hàng trả của đơn ${full.code}.`)).toBeVisible();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'received');
    await expect(page.getByText('Đã hoàn hàng').first()).toBeVisible();
    await expect(page.getByTestId('einvoice-adjustment')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('einvoice-adjustment')).toContainText('Đang chờ huỷ hoá đơn.');
    await expectNoAxeViolations(page);

    const state = await orderState(full.id);
    expect(state.status).toBe('returned');
    expect(state.refunds).toEqual([{ amount: full.total, status: 'requested' }]);
    const received = state.events.find((e) => e.type === 'return_received');
    expect(received?.metadata).toMatchObject({
      outcome: 'full',
      restocked: false,
      feesRefunded: true,
      refund: { total: full.total + 30_000, queued: full.total, shortfall: 30_000 },
    });
    const names = state.jobs.map((job) => job.name);
    expect(names).toEqual(expect.arrayContaining(['einvoice.adjust', 'return.notify']));
    expect(
      state.jobs.filter((job) => job.name === 'return.notify').map((j) => j.data.kind),
    ).toEqual(['approved', 'received']);
    expect(errors).toEqual([]);
  });

  test('staff see the request but only managers decide; reject with a reason', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, staff);
    await page.goto(`/admin/orders/${rejected.id}`);
    let section = await returnSection(page);
    await expect(section).toContainText(
      'Chỉ Quản lý hoặc Chủ shop được chấp nhận / từ chối yêu cầu đổi trả.',
    );
    await expect(section.getByRole('button', { name: 'Chấp nhận' })).toHaveCount(0);
    await page.context().clearCookies();

    await signIn(page, manager);
    await page.goto(`/admin/orders/${rejected.id}`);
    section = await returnSection(page);
    await section.getByRole('button', { name: 'Từ chối' }).click();
    const dialog = page.getByRole('dialog', {
      name: `Từ chối yêu cầu trả hàng đơn ${rejected.code}?`,
    });
    const confirm = dialog.getByRole('button', { name: 'Từ chối' });
    await expect(confirm).toBeDisabled();
    await dialog
      .getByLabel('Lý do từ chối (gửi cho khách)')
      .fill('The seal of the returned bottle is broken.');
    await confirm.click();
    await expect(toast(page, `Đã từ chối yêu cầu trả hàng đơn ${rejected.code}.`)).toBeVisible();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'rejected');
    await expect(section).toContainText('The seal of the returned bottle is broken.');
    await expectNoAxeViolations(page);

    const state = await orderState(rejected.id);
    expect(state.status).toBe('delivered');
    expect(state.jobs.find((job) => job.name === 'return.notify')?.data).toMatchObject({
      requestId: rejectedRequest,
      kind: 'rejected',
    });
    expect(state.refunds).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a manager replaces an issued e-invoice from the panel', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, manager);
    await page.goto(`/admin/orders/${invoiced.id}`);
    const panel = page.getByTestId('einvoice-status');
    await expect(panel).toHaveAttribute('data-state', 'issued');
    await panel.getByRole('button', { name: 'Lập hoá đơn thay thế' }).click();
    const dialog = page.getByRole('dialog', { name: /^Lập hoá đơn thay thế cho / });
    await expect(dialog).toContainText('đã trừ hàng khách trả');
    const confirm = dialog.getByRole('button', { name: 'Lập hoá đơn thay thế' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Lý do (ghi trên hoá đơn / biên bản)').fill('Sai tên người mua');
    await expectNoAxeViolations(page);
    await confirm.click();
    await expect(toast(page, 'Đã xếp lịch lập hoá đơn thay thế.')).toBeVisible();
    await expect(page.getByTestId('einvoice-adjustment')).toContainText(
      'Đang chờ thay thế hoá đơn.',
    );
    await expect(panel.getByRole('button', { name: 'Huỷ hoá đơn' })).toHaveCount(0);
    await expect(page.getByText('Yêu cầu thay thế hoá đơn điện tử')).toBeVisible();

    const state = await orderState(invoiced.id);
    const request = state.events.find((e) => e.type === 'einvoice_adjust_requested');
    expect(request).toMatchObject({ message: 'Sai tên người mua' });
    expect(request?.metadata).toMatchObject({ action: 'replace', source: 'staff' });
    expect(state.jobs.map((job) => job.name)).toContain('einvoice.adjust');
    expect(errors).toEqual([]);
  });
});
