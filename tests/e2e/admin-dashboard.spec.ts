import { expect as baseExpect, test } from '@playwright/test';
import { uuidv7 } from 'uuidv7';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  signInAdmin,
} from './helpers/admin-session';
import { withDb } from './helpers/payment-orders';
import type { StaffAccount } from './helpers/staff';

/*
 * KPI dashboard (M3, desktop): a Manager switches the Vietnam-time date range and reads the
 * KPIs, daily chart (with its data table), orders by status and best sellers; Staff see order
 * counts but no money; Editors see only their counters. One confirmed order with a large
 * quantity is inserted for today so the best-seller list is predictable, and removed after.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

test.describe.serial('admin KPI dashboard', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const orderId = uuidv7();
  let productName: string;
  let manager: StaffAccount;
  let staff: StaffAccount;
  let editor: StaffAccount;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL!;
    manager = await createStaff(baseURL, 'manager');
    staff = await createStaff(baseURL, 'staff');
    editor = await createStaff(baseURL, 'editor');
    productName = await withDb(async (db) => {
      const { rows } = await db.query<{ product_id: string; variant_id: string; name: string }>(
        `select v.product_id, v.id as variant_id, t.name
         from product_variants v
         join products p on p.id = v.product_id and p.status = 'active'
         join product_translations t on t.product_id = p.id and t.locale = 'vi'
         order by v.sku limit 1`,
      );
      const line = rows[0]!;
      const code = `PF-E2E-${orderId.slice(-4).toUpperCase()}`;
      await db.query(
        `insert into orders (id, code, email, phone, customer_name, locale, status, payment_status,
           payment_method, subtotal, total, amount_paid)
         values ($1, $2, 'e2e@perfume.test', '0912345678', 'Khách E2E', 'vi', 'confirmed', 'paid',
           'vnpay', 99000000, 99000000, 99000000)`,
        [orderId, code],
      );
      await db.query(
        `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
           sku, unit_price, quantity, line_total)
         values ($1, $2, $3, $4, $5, '100 ml', 'E2E-SKU', 990000, 100, 99000000)`,
        [uuidv7(), orderId, line.product_id, line.variant_id, line.name],
      );
      return line.name;
    });
  });

  test.afterAll(async () => {
    await withDb((db) => db.query('delete from orders where id = $1', [orderId]));
  });

  test('manager switches ranges and reads KPIs, chart, statuses and best sellers', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, manager);
    await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible();

    const ranges = page.getByRole('navigation', { name: 'Khoảng thời gian' });
    await expect(ranges.getByRole('link', { name: '7 ngày' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const kpis = page.getByRole('region', { name: 'Chỉ số chính' });
    for (const label of [
      'Doanh thu thuần',
      'Tiền thu ròng',
      'Đơn đã đặt',
      'Giá trị đơn trung bình',
      'Tỉ lệ chuyển đổi (ước tính)',
    ]) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    const daily = page.getByRole('region', { name: 'Doanh thu thuần theo ngày' });
    await daily.getByText('Xem bảng số liệu').click();
    await expect(daily.locator('tbody > tr')).toHaveCount(7);
    const top = page.getByRole('region', { name: 'Sản phẩm bán chạy' });
    await expect(top.locator('tbody > tr').first()).toContainText(productName);
    // Units sold: this spec's order (100) plus whatever other specs bought of the same product.
    const unitsCell = top.locator('tbody > tr').first().locator('td').first();
    await expect
      .poll(async () => Number((await unitsCell.innerText()).replace(/\D/g, '')))
      .toBeGreaterThanOrEqual(100);
    await expect(page.getByRole('region', { name: 'Đơn theo trạng thái' })).toContainText(
      'Đã xác nhận',
    );
    await expect(page.getByRole('region', { name: 'Việc cần xử lý' })).toContainText(
      'COD chờ đối soát',
    );
    await expectNoAxeViolations(page);

    await ranges.getByRole('link', { name: 'Hôm nay' }).click();
    await expect(page).toHaveURL(/\?range=today$/);
    await expect(ranges.getByRole('link', { name: 'Hôm nay' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // One day: no daily chart; the order placed today still leads the best sellers.
    await expect(page.getByRole('region', { name: 'Doanh thu thuần theo ngày' })).toHaveCount(0);
    await expect(top.locator('tbody > tr').first()).toContainText(productName);
    await expectNoAxeViolations(page);

    for (const [name, days] of [
      ['30 ngày', 30],
      ['Tháng này', null],
    ] as const) {
      await ranges.getByRole('link', { name }).click();
      await expect(ranges.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      if (days) {
        await daily.getByText('Xem bảng số liệu').click();
        await expect(daily.locator('tbody > tr')).toHaveCount(days);
      }
      await expectNoAxeViolations(page);
    }
    expect(errors).toEqual([]);
  });

  test('staff see order counts without money; editors see only their counters', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signInAdmin(page, staff);
    const kpis = page.getByRole('region', { name: 'Chỉ số chính' });
    await expect(kpis.getByText('Đơn đã đặt', { exact: true })).toBeVisible();
    await expect(page.getByText('Doanh thu thuần', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Giá trị đơn trung bình')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Sản phẩm bán chạy' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Đơn theo trạng thái' })).toBeVisible();
    await expect(page.getByText('₫')).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.context().clearCookies();
    await signInAdmin(page, editor);
    await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Việc cần xử lý' })).toContainText(
      'Sản phẩm thiếu bản tiếng Anh',
    );
    await expect(page.getByRole('region', { name: 'Việc cần xử lý' })).toContainText(
      'Đánh giá chờ duyệt',
    );
    await expectNoAxeViolations(page);
  });
});
