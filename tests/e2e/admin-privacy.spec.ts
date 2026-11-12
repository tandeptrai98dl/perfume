import { expect, test } from '@playwright/test';
import { uuidv7 } from 'uuidv7';

import { uniqueEmail } from './helpers/account';
import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import { withDb } from './helpers/privacy';

/*
 * Admin privacy requests (M3, §11.2): the Owner works the queue (due dates, overdue flag),
 * starts and rejects a correction with a reason, and anonymises a deleted customer after
 * typing the e-mail. Managers cannot open the screen (§11.1: Owner only).
 */

const DAY = 24 * 3600_000;

async function seedSubject() {
  const email = uniqueEmail('privacy-admin');
  const userId = uuidv7();
  const deleteId = uuidv7();
  const correctId = uuidv7();
  const orderCode = `PF-E2E-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await withDb(async (db) => {
    await db.query(
      `insert into users (id, name, email, email_verified, phone) values ($1, 'E2E Xoá', $2, true, '0912000111')`,
      [userId, email],
    );
    await db.query(
      `insert into orders (id, code, user_id, email, phone, customer_name, locale, status, payment_method, subtotal, total)
       values ($1, $2, $3, $4, '0912000111', 'E2E Xoá', 'vi', 'completed', 'cod', 1000000, 1000000)`,
      [uuidv7(), orderCode, userId, email],
    );
    await db.query(
      `insert into privacy_requests (id, user_id, email, type, status, due_at, note, created_at, updated_at)
       values ($1, $2, $3, 'delete', 'received', $4, null, now(), now()),
              ($5, $2, $3, 'correct', 'received', $6, 'Sai số điện thoại trên đơn', now() - interval '12 days', now())`,
      [
        deleteId,
        userId,
        email,
        new Date(Date.now() + 20 * DAY),
        correctId,
        new Date(Date.now() - 2 * DAY),
      ],
    );
  });
  return { email, userId, deleteId, correctId, orderCode };
}

test.describe('admin privacy requests', () => {
  test('owner rejects a correction and anonymises a deletion request', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const subject = await seedSubject();
    const owner = await createStaff(baseURL!, 'owner');
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);

    await page.goto(`/admin/privacy-requests?q=${encodeURIComponent(subject.email)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Yêu cầu về dữ liệu cá nhân' }),
    ).toBeVisible();
    const rows = page.getByRole('row').filter({ hasText: subject.email });
    await expect(rows).toHaveCount(2);
    // Most urgent first: the overdue correction.
    await expect(rows.first()).toContainText('Chỉnh sửa');
    await expect(rows.first()).toContainText('Quá hạn');
    await expectNoAxeViolations(page);

    // Correction: start, then reject with a reason (sent to the customer).
    await page.goto(`/admin/privacy-requests/${subject.correctId}`);
    await expect(page.getByText('Sai số điện thoại trên đơn')).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu xử lý' }).click();
    await expect(toast(page, 'Đã chuyển sang đang xử lý.')).toBeVisible();
    await page.getByRole('button', { name: 'Từ chối' }).click();
    const reject = page.getByRole('dialog', { name: 'Từ chối yêu cầu' });
    await field(reject, 'Lý do từ chối').fill('Đơn đã xuất hoá đơn, không sửa được thông tin.');
    await reject.getByRole('button', { name: 'Từ chối yêu cầu' }).click();
    await expect(toast(page, 'Đã từ chối yêu cầu.')).toBeVisible();
    await expect(page.getByText('Yêu cầu đã đóng.')).toBeVisible();
    await expectNoAxeViolations(page);

    // Deletion: type-to-confirm, then the customer's data is anonymised.
    await page.goto(`/admin/privacy-requests/${subject.deleteId}`);
    await page.getByRole('button', { name: 'Ẩn danh hoá dữ liệu' }).click();
    const confirm = page.getByRole('dialog', { name: 'Ẩn danh hoá dữ liệu của khách?' });
    const submit = confirm.getByRole('button', { name: 'Ẩn danh hoá' });
    await expect(submit).toBeDisabled();
    await confirm.getByRole('textbox').fill(subject.email);
    await submit.click();
    await expect(toast(page, 'Đã ẩn danh hoá dữ liệu.')).toBeVisible();

    const state = await withDb(async (db) => {
      const user = await db.query('select name, email, phone, banned from users where id = $1', [
        subject.userId,
      ]);
      const order = await db.query(
        'select customer_name, phone, total::int as total from orders where code = $1',
        [subject.orderCode],
      );
      const requests = await db.query(
        'select type, status, note from privacy_requests where email = $1 order by type',
        [subject.email],
      );
      const jobs = await db.query(
        `select data->>'kind' as kind from pgboss.job where name = 'privacy.notify'
         and data->>'requestId' = any($1) order by created_on`,
        [[subject.correctId, subject.deleteId]],
      );
      return {
        user: user.rows[0],
        order: order.rows[0],
        requests: requests.rows,
        jobs: jobs.rows,
      };
    });
    expect(state.user).toMatchObject({ name: '[anonymized]', phone: null, banned: true });
    expect(state.user.email).not.toBe(subject.email);
    expect(state.order).toEqual({ customer_name: '[anonymized]', phone: '', total: 1_000_000 });
    expect(state.requests).toEqual([
      expect.objectContaining({ type: 'correct', status: 'rejected' }),
      expect.objectContaining({ type: 'delete', status: 'completed' }),
    ]);
    expect(state.jobs.map((job) => job.kind)).toEqual(['rejected', 'completed']);
    await expect(page.getByText('Ẩn danh hoá dữ liệu', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a manager cannot open the privacy queue', async ({ page, baseURL }) => {
    const manager = await createStaff(baseURL!, 'manager');
    await signInAdmin(page, manager);
    await page.goto('/admin/privacy-requests');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
    await expect(page.getByRole('link', { name: 'Yêu cầu dữ liệu' })).toHaveCount(0);
  });
});
