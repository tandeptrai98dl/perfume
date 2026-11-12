import { randomBytes } from 'node:crypto';

import { expect as baseExpect, test } from '@playwright/test';
import { uuidv7 } from 'uuidv7';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import { withDb } from './helpers/payment-orders';

/*
 * Admin customers (M3 wave 2, §11.2, desktop): the Owner finds a registered customer by
 * e-mail and a guest contact by phone, sees lifetime spend net of refunds and failed
 * deliveries, flags the account as a COD risk with a reason, adds an internal note and
 * exports the list as CSV. Managers use the screens without the export; Staff are refused
 * (§11.1: no access to /admin/customers).
 */

const expect = baseExpect.configure({ timeout: 15_000 });

const run = randomBytes(3).toString('hex');
const digits = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const subject = {
  userId: uuidv7(),
  name: `Khách E2E ${run}`,
  email: `e2e-customer-${run}@perfume.test`,
  phone: `091${digits()}`,
  guestName: `Khách lẻ ${run}`,
  guestPhone: `090${digits()}`,
  guestOrderId: uuidv7(),
};

const code = () => `PF-E2E-${randomBytes(2).toString('hex').toUpperCase()}`;

async function seed() {
  await withDb(async (db) => {
    await db.query(
      `insert into users (id, name, email, email_verified, phone, locale) values ($1, $2, $3, true, $4, 'en')`,
      [subject.userId, subject.name, subject.email, subject.phone],
    );
    const insert = `insert into orders (id, code, user_id, email, phone, customer_name, locale, status,
      payment_method, subtotal, total, amount_paid, amount_refunded, placed_at)
      values ($1, $2, $3, $4, $5, $6, 'vi', $7, 'cod', $8, $8, $9, $10, now() - $11::interval)`;
    // Registered: 3.2M paid with 0.2M refunded + 1.5M delivered = 4.5M; the cancelled order
    // does not count.
    await db.query(insert, [
      uuidv7(),
      code(),
      subject.userId,
      subject.email,
      subject.phone,
      subject.name,
      'completed',
      3_200_000,
      3_200_000,
      200_000,
      '3 days',
    ]);
    await db.query(insert, [
      uuidv7(),
      code(),
      subject.userId,
      subject.email,
      subject.phone,
      subject.name,
      'delivered',
      1_500_000,
      1_500_000,
      0,
      '2 days',
    ]);
    await db.query(insert, [
      uuidv7(),
      code(),
      subject.userId,
      subject.email,
      subject.phone,
      subject.name,
      'cancelled',
      9_000_000,
      0,
      0,
      '1 day',
    ]);
    // Guest contact with a failed delivery.
    await db.query(insert, [
      subject.guestOrderId,
      code(),
      null,
      '',
      subject.guestPhone,
      subject.guestName,
      'returned',
      2_000_000,
      0,
      0,
      '5 days',
    ]);
    await db.query(
      `insert into order_events (id, order_id, type, from_status, to_status, actor_type)
       values ($1, $2, 'status_changed', 'shipped', 'delivery_failed', 'staff')`,
      [uuidv7(), subject.guestOrderId],
    );
  });
}

test.describe.serial('admin customers', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  test.beforeAll(async () => {
    await seed();
  });

  test('owner reviews a customer, flags the COD risk, adds a note and exports', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const owner = await createStaff(baseURL!, 'owner');
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);

    await page.goto('/admin');
    await page.getByRole('link', { name: 'Danh sách khách hàng' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Khách hàng' })).toBeVisible();
    await field(page, 'Tìm theo tên, số điện thoại hoặc email').fill(subject.email);
    const row = page.getByRole('row').filter({ visible: true }).filter({ hasText: subject.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('4.500.000');
    await expect(row).toContainText(subject.phone);
    await expect(page.getByRole('row').filter({ visible: true })).toHaveCount(2);
    await expectNoAxeViolations(page);

    await row.getByRole('link', { name: subject.name }).click();
    await expect(page.getByRole('heading', { level: 1, name: subject.name })).toBeVisible();
    await expect(
      page.getByText('Tiếng Anh', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    const orders = page.getByRole('table', { name: 'Lịch sử đơn hàng' });
    await expect(orders.getByRole('row')).toHaveCount(4);
    await expectNoAxeViolations(page);

    // COD risk flag with a reason (audited); the dialog refuses an empty reason.
    await page.getByRole('button', { name: 'Gắn cờ rủi ro COD' }).click();
    const dialog = page.getByRole('dialog', { name: `Gắn cờ rủi ro COD cho ${subject.name}?` });
    const confirm = dialog.getByRole('button', { name: 'Gắn cờ rủi ro COD' });
    await expect(confirm).toBeDisabled();
    await field(dialog, 'Lý do').fill('Từ chối nhận hàng hai lần');
    await expectNoAxeViolations(page);
    await confirm.click();
    await expect(toast(page, 'Đã gắn cờ rủi ro COD.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bỏ cờ rủi ro' })).toBeVisible();
    await expect(
      page.getByText('Từ chối nhận hàng hai lần').filter({ visible: true }),
    ).toBeVisible();

    // Internal note.
    await field(page, 'Thêm ghi chú').fill('Khách muốn nhận hàng sau 18 giờ');
    await page.getByRole('button', { name: 'Lưu ghi chú' }).click();
    await expect(toast(page, 'Đã lưu ghi chú.')).toBeVisible();
    await expect(
      page.getByText('Khách muốn nhận hàng sau 18 giờ').filter({ visible: true }),
    ).toBeVisible();

    // Flagged customers: dashboard counter → filtered list.
    await page.goto('/admin/customers?risk=flagged');
    await expect(
      page.getByRole('row').filter({ visible: true }).filter({ hasText: subject.name }),
    ).toContainText('Gắn cờ rủi ro');

    // Guest contact found by phone, with its failed delivery.
    await page.goto(`/admin/customers?q=${subject.guestPhone}`);
    const guest = page
      .getByRole('row')
      .filter({ visible: true })
      .filter({ hasText: subject.guestName });
    await expect(guest).toContainText('Khách vãng lai');
    await expect(guest).toContainText('1 lần giao thất bại');
    await guest.getByRole('link', { name: subject.guestName }).click();
    await expect(page.getByRole('heading', { level: 1, name: subject.guestName })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Gắn cờ rủi ro COD' }).filter({ visible: true }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);

    // CSV export (Owner): filtered, audited.
    const response = await page.request.get(
      `/api/admin/customers/export?q=${encodeURIComponent(subject.email)}`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain(subject.email);
    expect(csv).toContain(',4500000,');
    expect(csv.trim().split('\r\n')).toHaveLength(2);

    const audit = await withDb(async (db) => {
      const { rows } = await db.query<{ action: string }>(
        `select action from audit_logs where entity_type = 'user'
           and (entity_id = $1 or (action = 'customer.export' and actor_id = (select id from users where email = $2)))
         order by created_at`,
        [subject.userId, owner.email],
      );
      return rows.map((r) => r.action);
    });
    expect(audit).toEqual(['customer.codRiskFlag', 'customer.note', 'customer.export']);
    expect(errors).toEqual([]);
  });

  test('a manager sees full contacts but cannot export', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const manager = await createStaff(baseURL!, 'manager');
    await signInAdmin(page, manager);
    await page.goto(`/admin/customers?q=${encodeURIComponent(subject.email)}`);
    await expect(
      page.getByRole('row').filter({ visible: true }).filter({ hasText: subject.name }),
    ).toContainText(subject.email);
    await expect(page.getByRole('link', { name: 'Xuất CSV' })).toHaveCount(0);
    const denied = await page.request.get('/api/admin/customers/export');
    expect(denied.status()).toBe(403);
  });

  test('staff cannot open the customer screens', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const staff = await createStaff(baseURL!, 'staff');
    await signInAdmin(page, staff);
    await page.goto('/admin/customers');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
    await expect(page.getByRole('link', { name: 'Danh sách khách hàng' })).toHaveCount(0);
  });
});
