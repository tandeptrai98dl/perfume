import { randomInt } from 'node:crypto';

import { expect as baseExpect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
} from './helpers/admin-session';
import { cleanupOrders, withDb } from './helpers/payment-orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Manual orders (desktop admin, §11.2 `/admin/orders/new`): a Staff member creates a COD order
 * for a new phone customer (confirmed on the phone), and an online order whose payment link
 * opens the customer's payment page in the chosen language. Needs DATABASE_URL.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

const PRODUCT = { search: 'MAIS-CEDR-EDT-50', name: /^Thêm .*50 ml/ };

/** Unique valid mobile number per test (lookups and coupon rules key on the phone). */
function testPhone() {
  return `09${[1, 3, 4, 6, 7, 8][randomInt(0, 6)]}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

async function pick(page: Page, combobox: string, search: string, option: string) {
  const trigger = page.getByRole('combobox', { name: combobox });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.keyboard.type(search);
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}

async function orderIdsByPhone(phone: string): Promise<string[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>('select id from orders where phone = $1', [
      phone,
    ]);
    return rows.map((row) => row.id);
  });
}

async function fillOrder(page: Page, phone: string) {
  // Lookup: a new number has no match; the number is carried into the phone field.
  await field(page, 'Tìm khách theo số điện thoại hoặc email').fill(phone);
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(page.getByText('Không tìm thấy khách.', { exact: false })).toBeVisible();
  await expect(field(page, 'Số điện thoại')).toHaveValue(phone);
  await field(page, 'Họ và tên').fill('Khách Điện Thoại E2E');

  await field(page, 'Tìm sản phẩm theo tên, thương hiệu hoặc SKU').fill(PRODUCT.search);
  await page.getByRole('button', { name: PRODUCT.name }).first().click();
  await expect(page.getByTestId('manual-order-line')).toHaveCount(1);
  await page.getByRole('spinbutton', { name: /^Số lượng/ }).fill('2');

  await pick(page, 'Tỉnh, thành phố', 'ho chi minh', 'Thành phố Hồ Chí Minh');
  await pick(page, 'Phường, xã', 'ben thanh', 'Phường Bến Thành');
  await field(page, 'Số nhà, tên đường').fill('45 Nguyễn Huệ');
  // The first delivery option is preselected by the server summary.
  await expect(page.getByRole('radiogroup').first().getByRole('radio').first()).toBeChecked();
  // 2 × 2,300,000 ₫, free standard shipping above the threshold.
  await expect(page.getByTestId('manual-order-total')).toHaveText(/4\.600\.000/);
}

test.describe.serial('admin manual orders', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  let staff: StaffAccount;
  const phones: string[] = [];

  test.beforeAll(async ({ baseURL }) => {
    staff = await createStaff(baseURL!, 'staff');
  });

  test.afterAll(async () => {
    const ids = (await Promise.all(phones.map(orderIdsByPhone))).flat();
    await cleanupOrders(ids);
  });

  test('creates a COD order confirmed on the phone for a new customer', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const phone = testPhone();
    phones.push(phone);
    await signInAdmin(page, staff);

    await page.goto('/admin/orders');
    await page.getByRole('link', { name: 'Tạo đơn thủ công' }).click();
    await expect(page).toHaveURL(/\/admin\/orders\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tạo đơn thủ công' })).toBeVisible();
    await expectNoAxeViolations(page);

    await fillOrder(page, phone);
    await page.getByRole('radio', { name: /Thanh toán khi nhận hàng/ }).click();
    await expect(
      page.getByRole('switch', { name: 'Khách đã xác nhận qua điện thoại' }),
    ).toBeChecked();
    // A Staff member cannot confirm bank transfers: no "received" switch for them.
    await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).click();
    await expect(page.getByRole('switch', { name: 'Đã nhận tiền chuyển khoản' })).toHaveCount(0);
    await page.getByRole('radio', { name: /Thanh toán khi nhận hàng/ }).click();
    await field(page, 'Ghi chú nội bộ').fill('Khách hẹn giao giờ hành chính');
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
    const result = page.getByTestId('manual-order-result');
    await expect(result.getByRole('heading', { name: /^Đã tạo đơn PF-/ })).toBeVisible();
    await expect(result.getByText('Đã xác nhận')).toBeVisible();
    await expect(result.getByRole('textbox')).toHaveCount(0); // no payment link for COD
    await expectNoAxeViolations(page);

    const [orderId] = await orderIdsByPhone(phone);
    const row = await withDb(async (db) => {
      const { rows } = await db.query<{
        source: string;
        status: string;
        email: string;
        total: string;
        internal_note: string;
        created_by: string | null;
      }>(
        'select source, status, email, total, internal_note, created_by from orders where id = $1',
        [orderId],
      );
      return rows[0]!;
    });
    expect(row).toMatchObject({
      source: 'admin',
      status: 'confirmed',
      email: '',
      internal_note: 'Khách hẹn giao giờ hành chính',
    });
    expect(Number(row.total)).toBe(4_600_000);
    expect(row.created_by).not.toBeNull();

    await result.getByRole('link', { name: 'Xem đơn hàng' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}$`));
    await expect(page.getByText('Nhân viên tạo đơn thủ công')).toBeVisible();
    await expect(page.getByText('Khách hẹn giao giờ hành chính')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('creates an online order and hands out a payment link in English', async ({
    page,
    context,
  }) => {
    const errors = collectConsoleErrors(page);
    const phone = testPhone();
    phones.push(phone);
    await signInAdmin(page, staff);
    await page.goto('/admin/orders/new');

    await fillOrder(page, phone);
    await field(page, 'Email (không bắt buộc)').fill(`e2e-manual-${phone}@perfume.test`);
    await page.getByRole('combobox', { name: 'Ngôn ngữ email và trang thanh toán' }).click();
    await page.getByRole('option', { name: 'Tiếng Anh' }).click();
    await page.getByRole('radio', { name: /Gửi link thanh toán/ }).click();
    await expect(page.getByRole('combobox', { name: 'Cổng thanh toán' })).toHaveText('VietQR');

    await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
    const result = page.getByTestId('manual-order-result');
    await expect(result.getByText('Chờ thanh toán')).toBeVisible();
    const link = result.getByRole('textbox', { name: 'Link thanh toán VietQR' });
    await expect(link).toHaveValue(/\/en\/checkout\/result\?code=PF-\d{6}-[2-9A-HJKMNP-Z]{4}&t=/);
    await expectNoAxeViolations(page);

    const [orderId] = await orderIdsByPhone(phone);
    const payment = await withDb(async (db) => {
      const { rows } = await db.query<{ provider: string; status: string; amount: string }>(
        'select provider, status, amount from payments where order_id = $1',
        [orderId],
      );
      return rows;
    });
    expect(payment).toEqual([{ provider: 'payos', status: 'pending', amount: '4600000' }]);

    // The customer opens the link in another browser (no admin session, no order cookie).
    const url = await link.inputValue();
    const customer = await context.browser()!.newContext();
    const customerPage = await customer.newPage();
    await customerPage.goto(url);
    await expect(customerPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(customerPage.getByTestId('checkout-result')).toHaveAttribute(
      'data-state',
      'awaitingPayment',
    );
    await customer.close();
    expect(errors).toEqual([]);
  });
});
