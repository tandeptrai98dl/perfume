import { readFile } from 'node:fs/promises';

import { expect as baseExpect, test } from '@playwright/test';
import { uuidv7 } from 'uuidv7';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
} from './helpers/admin-session';
import { withDb } from './helpers/payment-orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Audit log viewer (M3, desktop): a Manager filters the log, pages through it with keyset
 * pagination, opens a diff and follows an entity link; contact data never shows. Only the
 * Owner can export CSV, and the export itself is audited. Entries are inserted directly with a
 * unique action prefix and removed afterwards.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

test.describe.serial('admin audit log', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const prefix = `e2e${Date.now().toString(36)}`;
  let owner: StaffAccount;
  let manager: StaffAccount;
  let staff: StaffAccount;
  let orderEntityId: string;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL!;
    owner = await createStaff(baseURL, 'owner');
    manager = await createStaff(baseURL, 'manager');
    staff = await createStaff(baseURL, 'staff');
    orderEntityId = uuidv7();
    await withDb(async (db) => {
      const { rows } = await db.query<{ id: string }>('select id from users where email = $1', [
        manager.email,
      ]);
      const actorId = rows[0]!.id;
      // 60 entries: one page of 50 plus 10; the newest carries contact data in its diff.
      for (let i = 0; i < 60; i += 1) {
        const contact = i === 59;
        await db.query(
          `insert into audit_logs (id, actor_id, action, entity_type, entity_id, diff, ip, created_at)
           values ($1, $2, $3, 'order', $4, $5, '203.113.4.17', now() - make_interval(secs => $6))`,
          [
            uuidv7(),
            actorId,
            `${prefix}.${contact ? 'note' : 'status'}`,
            contact ? orderEntityId : `e2e-${i}`,
            JSON.stringify(
              contact
                ? {
                    note: { from: null, to: 'Khách huong.e2e@gmail.com, gọi 0912 345 678' },
                    status: { from: 'confirmed', to: 'processing' },
                  }
                : { status: { from: 'pending', to: 'confirmed' }, index: i },
            ),
            60 - i,
          ],
        );
      }
    });
  });

  test.afterAll(async () => {
    await withDb((db) =>
      db.query(
        `delete from audit_logs where action like $1 or (action = 'audit_log.export' and diff->'filter'->>'action' like $1)`,
        [`${prefix}%`],
      ),
    );
  });

  test('manager filters, pages and reads diffs without contact data', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, manager);
    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Nhật ký thao tác', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký thao tác' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xuất CSV' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    const filters = page.getByRole('form', { name: 'Bộ lọc nhật ký' });
    await filters.getByLabel('Loại đối tượng').selectOption('order');
    await field(filters, 'Hành động (bắt đầu bằng)').fill(`${prefix}.`);
    await filters.getByRole('button', { name: 'Lọc' }).click();
    await expect(page).toHaveURL(new RegExp(`action=${prefix}`));

    const rows = page
      .getByRole('table', { name: 'Nhật ký thao tác' })
      .locator(':scope > tbody > tr');
    await expect(rows).toHaveCount(50);
    // Newest first: the entry with contact data.
    const first = rows.first();
    await expect(first).toContainText(`${prefix}.note`);
    await expect(first).toContainText('203.113.4.*');
    await expect(first).not.toContainText('203.113.4.17');
    await first.getByText('Xem 2 thay đổi').click();
    await expect(first).toContainText('h***@gmail.com');
    await expect(first).toContainText('***678');
    await expect(page.locator('body')).not.toContainText('huong.e2e@gmail.com');
    await expect(page.locator('body')).not.toContainText('345 678');
    await expect(first.getByRole('link', { name: `Mở Đơn hàng ${orderEntityId}` })).toHaveAttribute(
      'href',
      `/admin/orders/${orderEntityId}`,
    );
    await expectNoAxeViolations(page);

    const pagination = page.getByRole('navigation', { name: 'Phân trang nhật ký' });
    await pagination.getByRole('link', { name: 'Cũ hơn' }).click();
    await expect(rows).toHaveCount(10);
    await expect(rows.last()).toContainText('e2e-0');
    await expect(pagination.getByRole('link', { name: 'Cũ hơn' })).toHaveCount(0);
    await pagination.getByRole('link', { name: 'Mới hơn' }).click();
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText(`${prefix}.note`);

    // Filter by actor and a date range in the past: nothing.
    await filters.getByLabel('Từ ngày').fill('2020-01-01');
    await filters.getByLabel('Đến ngày').fill('2020-01-02');
    await filters.getByRole('button', { name: 'Lọc' }).click();
    await expect(page.getByText('Không có mục nào phù hợp.')).toBeVisible();
    await page.getByRole('link', { name: 'Xoá bộ lọc' }).click();
    await expect(page).toHaveURL(/\/admin\/audit-log$/);
    expect(errors).toEqual([]);
  });

  test('owner exports CSV (audited); staff cannot open the log', async ({ page }) => {
    test.setTimeout(180_000);
    await signInAdmin(page, owner);
    await page.goto(`/admin/audit-log?action=${prefix}.`);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Xuất CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await file.path())!, 'utf8');
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('created_at,actor,actor_role,action,entity_type,entity_id,diff,ip');
    expect(lines).toHaveLength(61);
    expect(csv).not.toContain('huong.e2e@gmail.com');
    expect(csv).not.toContain('203.113.4.17');

    await page.goto('/admin/audit-log?action=audit_log.export');
    await expect(
      page.getByRole('table', { name: 'Nhật ký thao tác' }).locator(':scope > tbody > tr').first(),
    ).toContainText('audit_log.export');

    await page.context().clearCookies();
    await signInAdmin(page, staff);
    await page.goto('/admin/audit-log');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
    const response = await page.request.get('/api/admin/audit-log/export');
    expect(response.status()).toBe(403);
  });
});
