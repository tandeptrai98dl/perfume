import { expect as baseExpect, test } from '@playwright/test';
import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  signInAdmin as signIn,
  toast,
} from './helpers/admin-session';
import { createE2EOrder, deleteE2EOrders, type E2EOrder } from './helpers/orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Admin e-invoices and notification log (M3, D13). The worker does not run during E2E, so the
 * spec writes the states the `einvoice.issue` job and the notification module produce (failed
 * invoice, issued invoice, notification_logs rows) and checks what staff see and do: the
 * failed list, "Xuất lại" (enqueues a new job), "Xem hoá đơn", the order's notification log.
 * Desktop admin only (≥ 1024 px).
 */

const expect = baseExpect.configure({ timeout: 15_000 });

async function sql<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(text, values)).rows;
  } finally {
    await db.end();
  }
}

async function markDelivered(orderId: string) {
  await sql(
    `update orders set status = 'delivered', shipped_at = now() - interval '2 days',
       delivered_at = now() - interval '1 hour' where id = $1`,
    [orderId],
  );
}

async function einvoiceEvent(orderId: string, type: string, metadata: Record<string, unknown>) {
  await sql(
    `insert into order_events (id, order_id, type, message, actor_type, metadata)
     values ($1, $2, $3, $4, 'system', $5)`,
    [uuidv7(), orderId, type, (metadata.reason as string | undefined) ?? null, metadata],
  );
}

test.describe.serial('admin e-invoices', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36).toUpperCase();
  const created: E2EOrder[] = [];
  let staff: StaffAccount;
  let failed: E2EOrder;
  let issued: E2EOrder;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    staff = await createStaff(testInfo.project.use.baseURL!, 'staff');

    failed = await createE2EOrder({ customerName: `E2E Admin ${run} F`, status: 'processing' });
    issued = await createE2EOrder({ customerName: `E2E Admin ${run} I`, status: 'processing' });
    created.push(failed, issued);
    for (const order of created) await markDelivered(order.id);

    await einvoiceEvent(failed.id, 'einvoice_attempt_failed', { reason: 'timeout', attempt: 1 });
    await einvoiceEvent(failed.id, 'einvoice_failed', {
      reason: 'misa:InvalidTaxCode',
      attempt: 2,
      retryable: false,
    });

    await sql(`update orders set einvoice_ref = $2, einvoice_issued_at = now() where id = $1`, [
      issued.id,
      'C26SBX-SBX00001234',
    ]);
    await einvoiceEvent(issued.id, 'einvoice_issued', {
      ref: 'C26SBX-SBX00001234',
      provider: 'sandbox',
      invoiceNo: 'SBX00001234',
      series: 'C26SBX',
      templateCode: '1',
      transactionId: `SBX-${issued.id}`,
      lookupCode: 'SBX00001234',
      buyer: 'individual',
      attempt: 1,
    });
    for (const [channel, template, status, error] of [
      ['email', 'order_confirmation', 'sent', null],
      ['email', 'delivered', 'failed', 'Error: SMTP 550 mailbox [email] unavailable'],
      ['telegram', 'staff_alert:new_order', 'sent', null],
    ] as const) {
      await sql(
        `insert into notification_logs (id, channel, recipient, template, locale, ref_type, ref_id,
           status, error, sent_at)
         values ($1, $2::notification_channel, $3, $4, 'vi', 'order', $5,
           $6::notification_status, $7, case when $6::text = 'sent' then now() end)`,
        [
          uuidv7(),
          channel,
          channel === 'email' ? 'e***@perfume.test' : '***890',
          template,
          issued.id,
          status,
          error,
        ],
      );
    }
  });

  test.afterAll(async () => {
    if (process.env.DATABASE_URL && created.length > 0) {
      const ids = created.map((o) => o.id);
      await sql(`delete from notification_logs where ref_id = any($1::text[])`, [ids]);
      await sql(
        `delete from pgboss.job where name = 'einvoice.issue' and data->>'orderId' = any($1)`,
        [ids],
      ).catch(() => undefined);
    }
    await deleteE2EOrders(created);
  });

  test('staff find a failed e-invoice and retry it', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, staff);

    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Hoá đơn điện tử lỗi', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Hoá đơn điện tử lỗi' }),
    ).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: failed.code });
    await expect(row).toContainText('misa:InvalidTaxCode');
    await expect(row).toContainText('Đã giao');
    await expect(page.getByRole('row').filter({ hasText: issued.code })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Keyboard: focus the row's retry button and press Enter.
    const retry = row.getByRole('button', { name: `Xuất lại hoá đơn đơn ${failed.code}` });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, 'Đã xếp lịch xuất lại hoá đơn điện tử.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: failed.code })).toHaveCount(0);

    const jobs = await sql<{ n: number }>(
      `select count(*)::int as n from pgboss.job where name = 'einvoice.issue' and data->>'orderId' = $1`,
      [failed.id],
    );
    expect(jobs[0]!.n).toBe(1);

    // Order detail: pending again, timeline shows the history, no second retry offered.
    await page.goto(`/admin/orders/${failed.id}`);
    const panel = page.getByTestId('einvoice-status');
    await expect(panel).toHaveAttribute('data-state', 'pending');
    await expect(panel).toContainText('Đang chờ xuất hoá đơn.');
    await expect(page.getByText('Yêu cầu xuất lại hoá đơn điện tử')).toBeVisible();
    await expect(page.getByText('Xuất hoá đơn điện tử thất bại', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('staff view an issued e-invoice and the notification log', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, staff);
    await page.goto(`/admin/orders/${issued.id}`);

    const panel = page.getByTestId('einvoice-status');
    await expect(panel).toHaveAttribute('data-state', 'issued');
    await expect(panel).toContainText('C26SBX-SBX00001234');
    await expect(panel.getByRole('button', { name: /Xuất lại/ })).toHaveCount(0);

    const log = page.getByTestId('notification-log');
    await expect(log.getByRole('row')).toHaveCount(4);
    await expect(log).toContainText('Xác nhận đơn hàng');
    await expect(log).toContainText('e***@perfume.test');
    await expect(log.getByRole('row').filter({ hasText: 'Đã giao hàng' })).toContainText('Lỗi');
    await expect(log).toContainText('Telegram');
    await expect(log).not.toContainText(`e2e-admin-${issued.code.toLowerCase()}`);
    await expectNoAxeViolations(page);

    await panel.getByRole('button', { name: 'Xem hoá đơn' }).click();
    const dialog = page.getByRole('dialog', { name: 'Hoá đơn C26SBX-SBX00001234' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('SBX00001234');
    await expect(dialog).toContainText('Sandbox (thử nghiệm)');
    await expect(dialog).toContainText('không có giá trị pháp lý');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });
});
