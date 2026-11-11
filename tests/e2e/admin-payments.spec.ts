import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';
import { uuidv7 } from 'uuidv7';

import { cleanupOrders, createTestOrder, orderState, withDb } from './helpers/orders';
import { createStaffWithTotp, freshTotp, type StaffAccount } from './helpers/staff';

/*
 * Payments admin (desktop): a manager completes a refund from the queue (late payment after
 * cancellation) and reconciles a COD remittance. Needs DATABASE_URL (the app's database).
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

test.describe.serial('admin payments', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const created: string[] = [];
  let manager: StaffAccount;

  test.beforeAll(async ({ baseURL }) => {
    manager = await createStaffWithTotp(baseURL!, 'manager');
  });

  test.afterAll(async () => {
    await cleanupOrders(created);
  });

  test('refund queue: complete the refund of a payment received after cancellation', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const order = await createTestOrder({
      method: 'payos',
      status: 'cancelled',
      paymentStatus: 'paid',
      amountPaid: 1_450_000,
      reservationMinutes: null,
    });
    created.push(order.id);
    await withDb(async (db) => {
      const paymentId = uuidv7();
      await db.query(
        `insert into payments (id, order_id, provider, kind, amount, status, txn_ref, paid_at)
         values ($1, $2, 'payos', 'full', 1450000, 'succeeded', $3, now())`,
        [paymentId, order.id, `9${Date.now()}`.slice(0, 16)],
      );
      await db.query(
        `insert into refunds (id, order_id, payment_id, amount, reason, method)
         values ($1, $2, $3, 1450000, 'late_payment_after_cancellation', 'gateway')`,
        [uuidv7(), order.id, paymentId],
      );
    });

    await signIn(page, manager);
    await page.getByRole('link', { name: 'Hoàn tiền', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/payments\/refunds$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hoàn tiền' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: order.code });
    await expect(row).toContainText('Nhận tiền sau khi đơn đã huỷ');
    await expectNoAxeViolations(page);

    await row.getByRole('button', { name: `Hoàn tất hoàn tiền đơn ${order.code}` }).click();
    const dialog = page.getByRole('dialog');
    // payOS has no refund API: only the manual mode is offered.
    await expect(dialog.getByRole('radio')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Xác nhận đã hoàn tiền' }).click();
    await expect(field(dialog, 'Mã tham chiếu giao dịch hoàn')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await field(dialog, 'Mã tham chiếu giao dịch hoàn').fill('FT-REFUND-E2E');
    await dialog.getByRole('button', { name: 'Xác nhận đã hoàn tiền' }).click();
    await expect(toast(page, 'Đã hoàn tất hoàn tiền')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: order.code })).toHaveCount(0);
    expect((await orderState(order.id)).payment_status).toBe('refunded');

    await page.goto('/admin/payments');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Giao dịch thanh toán' }),
    ).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: order.code })).toContainText('Đã hoàn');
    await expectNoAxeViolations(page);
    await page.goto('/admin/payments/events');
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký webhook' })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('COD remittance: tick the delivered order, totals match the bank receipt', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const order = await createTestOrder({
      method: 'cod',
      status: 'delivered',
      total: 2_150_000,
      reservationMinutes: null,
      deliveredAt: new Date(),
    });
    created.push(order.id);

    await signIn(page, manager);
    await page.getByRole('link', { name: 'Đối soát COD' }).click();
    await expect(page).toHaveURL(/\/admin\/payments\/cod-remittances$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Đối soát COD' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('combobox', { name: 'Đơn vị vận chuyển', exact: true }).click();
    await page.getByRole('option', { name: 'GHN', exact: true }).click();
    await page.getByRole('checkbox', { name: `Chọn đơn ${order.code}` }).check();
    await field(page, 'Phí đối soát (₫)').fill('15000');
    await field(page, 'Số tiền thực nhận (₫)').fill('2000000');
    await expect(page.getByTestId('cod-difference')).toContainText('Lệch');
    await field(page, 'Số tiền thực nhận (₫)').fill('2135000');
    await expect(page.getByTestId('cod-difference')).toHaveText('Khớp với số tiền thực nhận');
    await field(page, 'Mã giao dịch ngân hàng').fill('GHN-E2E-1');
    await page.getByRole('button', { name: 'Lưu đối soát' }).click();
    await expect(toast(page, 'Đã đối soát 1 đơn')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Chọn đơn ${order.code}` })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'GHN-E2E-1' })).toBeVisible();
    expect(await orderState(order.id)).toMatchObject({
      payment_status: 'paid',
      amount_paid: '2150000',
    });
    expect(errors).toEqual([]);

    await withDb((db) =>
      db.query(
        `delete from cod_remittances where id in
           (select remittance_id from cod_remittance_orders where order_id = $1)`,
        [order.id],
      ),
    );
  });
});
