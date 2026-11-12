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
  let phoned: ReturnOrder;
  let late: ReturnOrder;
  let cod: ReturnOrder;
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
      photo: true,
    });
    phoned = await insertReturnOrder({ locale: 'vi', email: email('phone') });
    late = await insertReturnOrder({ locale: 'vi', email: email('late'), deliveredDaysAgo: 10 });
    cod = await insertReturnOrder({ locale: 'vi', email: email('cod'), cod: true });
    ids.push(phoned.id, late.id, cod.id);
    await insertReturnRequest(cod, { reason: 'unopened', quantity: 2, description: '' });
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
    // The customer's photo: shown to staff through the authenticated route only.
    const photo = section.getByTestId('return-photo');
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute(
      'alt',
      `Ảnh 1 khách gửi cho yêu cầu trả hàng đơn ${full.code}`,
    );
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    const src = (await photo.getAttribute('src'))!;
    expect(src).toMatch(new RegExp(`^/api/admin/orders/${full.id}/return-photos/[0-9a-f-]+$`));
    const response = await page.request.get(src);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect(response.headers()['cache-control']).toContain('no-store');
    const anonymous = await page.context().browser()!.newContext();
    expect((await anonymous.request.get(new URL(src, page.url()).href)).status()).toBe(403);
    await anonymous.close();
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
    // The order's money goes back via the gateway; the return shipping beyond it is a manual
    // payout (bank transfer).
    expect(state.refunds).toEqual([
      { amount: full.total, status: 'requested', method: 'gateway', reason: 'return:defective' },
      {
        amount: 30_000,
        status: 'requested',
        method: 'bank_transfer',
        reason: 'return_shipping_payout',
      },
    ]);
    await expect(section).toContainText('vượt số tiền đơn đang giữ');
    const received = state.events.find((e) => e.type === 'return_received');
    expect(received?.metadata).toMatchObject({
      outcome: 'full',
      restocked: false,
      feesRefunded: true,
      refund: { total: full.total + 30_000, queued: full.total, payout: 30_000, shortfall: 0 },
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

  test('staff open a return for a customer who called; late returns need a manager', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, staff);
    await page.goto(`/admin/orders/${late.id}`);
    let section = await returnSection(page);
    await expect(page.getByTestId('open-return-expired')).toContainText(
      'Chỉ Quản lý hoặc Chủ shop được tạo yêu cầu trả hàng ngoại lệ.',
    );

    await page.goto(`/admin/orders/${phoned.id}`);
    section = await returnSection(page);
    await section.getByRole('button', { name: 'Tạo yêu cầu trả hàng thay khách' }).click();
    const dialog = page.getByRole('dialog', {
      name: `Tạo yêu cầu trả hàng cho đơn ${phoned.code}`,
    });
    const confirm = dialog.getByRole('button', { name: 'Tạo yêu cầu' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Sản phẩm lỗi' }).check();
    await dialog.getByLabel('Số lượng trả: ').fill('1');
    await dialog.getByLabel('Mô tả của khách').fill('Khách gọi: nắp chai bị nứt.');
    await expectNoAxeViolations(page);
    await confirm.click();
    await expect(toast(page, `Đã tạo yêu cầu trả hàng cho đơn ${phoned.code}.`)).toBeVisible();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'requested');
    await expect(section).toContainText('Nhân viên tạo yêu cầu thay khách');
    await expect(section).toContainText('trả 1/2');
    await expectNoAxeViolations(page);
    const state = await orderState(phoned.id);
    expect(state.status).toBe('return_requested');
    expect(state.events.find((e) => e.type === 'return_requested')?.metadata).toMatchObject({
      openedBy: 'staff',
      reason: 'defective',
      lines: [{ orderItemId: phoned.itemId, quantity: 1 }],
    });
    await page.context().clearCookies();

    // A manager may lift the window, with a reason.
    await signIn(page, manager);
    await page.goto(`/admin/orders/${late.id}`);
    section = await returnSection(page);
    await section.getByRole('button', { name: 'Tạo yêu cầu trả hàng thay khách' }).click();
    const override = page.getByRole('dialog', {
      name: `Tạo yêu cầu trả hàng cho đơn ${late.code}`,
    });
    await expect(override).toContainText('Đã quá thời hạn trả hàng');
    await override.getByRole('radio', { name: 'Vỡ / hư hỏng' }).check();
    await override.getByLabel('Mô tả của khách').fill('Khách đi công tác, chai vỡ trong hộp.');
    await override
      .getByLabel('Lý do cho phép trả sau thời hạn')
      .fill('Khách báo lỗi trong hạn qua Zalo');
    await override.getByRole('button', { name: 'Tạo yêu cầu' }).click();
    await expect(toast(page, `Đã tạo yêu cầu trả hàng cho đơn ${late.code}.`)).toBeVisible();
    await expect(section).toContainText(
      'Quản lý cho phép trả hàng sau thời hạn: Khách báo lỗi trong hạn qua Zalo',
    );
    expect(errors).toEqual([]);
  });

  test('COD returned before remittance: reconciling it queues the refund owed', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, manager);
    await page.goto(`/admin/orders/${cod.id}`);
    const section = await returnSection(page);
    await section.getByRole('button', { name: 'Chấp nhận' }).click();
    await page
      .getByRole('dialog', { name: `Chấp nhận yêu cầu trả hàng đơn ${cod.code}?` })
      .getByRole('button', { name: 'Chấp nhận' })
      .click();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'approved');
    await section.getByRole('button', { name: 'Đã nhận lại hàng' }).click();
    await page
      .getByRole('dialog', { name: `Xác nhận đã nhận hàng trả của đơn ${cod.code}?` })
      .getByRole('button', { name: 'Xác nhận đã nhận hàng' })
      .click();
    await expect(page.getByTestId('return-panel')).toHaveAttribute('data-status', 'received');
    const owed = cod.unitPrice * 2; // change of mind: the goods, not the delivery fee
    await expect(section).toContainText(`Còn phải hoàn ${vnd(owed)}`);
    expect((await orderState(cod.id)).refunds).toEqual([]);

    await page.goto('/admin/payments/cod-remittances');
    const row = page.getByRole('row').filter({ hasText: cod.code });
    await expect(row).toContainText('Khách đã trả hàng');
    await expect(row.getByTestId('cod-deferred-refund')).toContainText(vnd(owed));
    await expectNoAxeViolations(page);
    await page.getByRole('combobox', { name: 'Đơn vị vận chuyển', exact: true }).click();
    await page.getByRole('option', { name: 'GHN', exact: true }).click();
    await page.getByRole('checkbox', { name: `Chọn đơn ${cod.code}` }).check();
    await page.getByLabel('Số tiền thực nhận (₫)', { exact: true }).fill(String(cod.total));
    await page.getByRole('button', { name: 'Lưu đối soát' }).click();
    await expect(toast(page, 'Đã đối soát 1 đơn')).toBeVisible();

    const state = await orderState(cod.id);
    expect(state.status).toBe('returned');
    expect(state.refunds).toEqual([
      { amount: owed, status: 'requested', method: 'bank_transfer', reason: 'return:unopened' },
    ]);
    await page.goto('/admin/payments/refunds');
    await expect(page.getByRole('row').filter({ hasText: cod.code })).toContainText(
      'Khách trả hàng: Đổi ý (còn seal)',
    );
    expect(errors).toEqual([]);
  });
});
