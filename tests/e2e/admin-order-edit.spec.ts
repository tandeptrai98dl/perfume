import { randomInt } from 'node:crypto';

import { expect as baseExpect, test } from '@playwright/test';
import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin as signIn,
  toast,
} from './helpers/admin-session';
import type { StaffAccount } from './helpers/staff';

/*
 * Admin order edits before shipment (§3.4 step 8, §11.2 "Order edits"): staff change the
 * quantity, add a product and fix the address, preview the new totals, save; a concurrent change
 * is refused; a shipped order can no longer be edited; only a manager overrides shipping.
 * Orders are confirmed COD orders with their stock committed (inserted directly); the stock of
 * the variants they touch is restored and the orders deleted afterwards. Desktop admin only.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

type Variant = { id: string; productId: string; sku: string; price: number; name: string };
type Fixture = { id: string; code: string };

async function withDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for admin E2E tests');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Two sellable variants of different products with stock to spare (seed data). */
async function pickVariants(): Promise<[Variant, Variant]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{
      id: string;
      product_id: string;
      sku: string;
      price: string;
      name: string;
    }>(
      `select * from (
         select distinct on (v.product_id) v.id, v.product_id, v.sku, v.price, t.name
           from product_variants v
           join products p on p.id = v.product_id and p.status = 'active' and p.deleted_at is null
           join brands b on b.id = p.brand_id and b.status = 'active' and b.deleted_at is null
           join product_translations t on t.product_id = p.id and t.locale = 'vi' and t.is_published
           join inventory_items ii on ii.variant_id = v.id
          where v.is_active and v.variant_type in ('full_size', 'travel')
            and ii.on_hand - ii.reserved >= 5 and v.price <= 4000000
          order by v.product_id, v.price
       ) picked order by sku limit 2`,
    );
    if (rows.length < 2) throw new Error('Seed needs two variants with stock: run pnpm db:seed');
    const map = (r: (typeof rows)[number]): Variant => ({
      id: r.id,
      productId: r.product_id,
      sku: r.sku,
      price: Number(r.price),
      name: r.name,
    });
    return [map(rows[0]!), map(rows[1]!)];
  });
}

function orderCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const now = new Date(Date.now() + 7 * 3_600_000);
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += alphabet[randomInt(alphabet.length)];
  return `PF-${now.toISOString().slice(2, 10).replaceAll('-', '')}-${suffix}`;
}

/** Confirmed COD order of one unit whose stock is committed (deducted), like after confirm. */
async function confirmedOrder(variant: Variant, customerName: string): Promise<Fixture> {
  return withDb(async (db) => {
    const id = uuidv7();
    const code = orderCode();
    const phone = `0912${String(randomInt(100_000, 999_999))}`;
    await db.query('begin');
    try {
      await db.query(
        `insert into orders (id, code, email, phone, customer_name, locale, status, payment_method,
           subtotal, shipping_fee, total, confirmed_at)
         values ($1, $2, $3, $4, $5, 'vi', 'confirmed', 'cod', $6, 30000, $7, now())`,
        [
          id,
          code,
          `e2e-edit-${code.toLowerCase()}@perfume.test`,
          phone,
          customerName,
          variant.price,
          variant.price + 30_000,
        ],
      );
      await db.query(
        `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
           sku, unit_price, quantity, line_total)
         values ($1, $2, $3, $4, $5, '100 ml', $6, $7, 1, $7)`,
        [uuidv7(), id, variant.productId, variant.id, variant.name, variant.sku, variant.price],
      );
      await db.query(
        `insert into order_addresses (order_id, type, full_name, phone, province_code, province_name,
           ward_code, ward_name, street)
         select $1, 'shipping', $2, $3, p.code, p.name, w.code, w.name, '12 Lê Lợi'
           from provinces p join wards w on w.province_code = p.code
          where p.code = '79' order by w.code limit 1`,
        [id, customerName, phone],
      );
      await db.query(
        `insert into stock_reservations (id, order_id, variant_id, location_id, quantity, status,
           expires_at)
         select $1, $2, $3, l.id, 1, 'committed', now() from locations l where l.is_default`,
        [uuidv7(), id, variant.id],
      );
      await db.query(
        `insert into order_events (id, order_id, type, to_status, actor_type)
         values ($1, $2, 'status_changed', 'confirmed', 'customer')`,
        [uuidv7(), id],
      );
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    return { id, code };
  });
}

test.describe.serial('admin order edits', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36).toUpperCase();
  const customer = `E2E Admin Edit ${run}`;
  const created: Fixture[] = [];
  let staff: StaffAccount;
  let manager: StaffAccount;
  let variants: [Variant, Variant];
  let stockBefore: { variant_id: string; on_hand: number }[] = [];

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    variants = await pickVariants();
    stockBefore = await withDb(
      async (db) =>
        (
          await db.query<{ variant_id: string; on_hand: number }>(
            'select variant_id, on_hand from inventory_items where variant_id = any($1::uuid[])',
            [variants.map((v) => v.id)],
          )
        ).rows,
    );
    const baseURL = testInfo.project.use.baseURL!;
    staff = await createStaff(baseURL, 'staff');
    manager = await createStaff(baseURL, 'manager');
  });

  test.afterAll(async () => {
    if (!process.env.DATABASE_URL) return;
    await withDb(async (db) => {
      const ids = created.map((o) => o.id);
      await db.query(
        `delete from stock_movements where ref_type = 'order' and ref_id = any($1::uuid[])`,
        [ids],
      );
      await db.query('delete from orders where id = any($1::uuid[])', [ids]);
      for (const row of stockBefore) {
        await db.query('update inventory_items set on_hand = $2 where variant_id = $1', [
          row.variant_id,
          row.on_hand,
        ]);
      }
    });
  });

  test('staff edit quantity, add a product and fix the address with a preview', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = collectConsoleErrors(page);
    const [first, second] = variants;
    const order = await confirmedOrder(first, customer);
    created.push(order);
    await signIn(page, staff);

    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByRole('heading', { level: 1, name: order.code })).toBeVisible();
    await page.getByRole('link', { name: 'Sửa đơn' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `Sửa đơn ${order.code}` }),
    ).toBeVisible();
    await expect(page.getByText(/chỉ Quản lý hoặc Chủ shop được ghi đè/i)).toBeVisible();
    await expectNoAxeViolations(page);

    // Nothing changed yet: the preview says so and saving stays disabled.
    await page.getByRole('button', { name: 'Tính lại' }).click();
    await expect(page.getByText('Chưa có thay đổi nào so với đơn hiện tại.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();

    // +1 of the existing line, add another product from the picker, change the street.
    const items = page.getByRole('table', { name: 'Sản phẩm' });
    await items.getByRole('button', { name: /^Tăng / }).click();
    await field(page, 'Thêm sản phẩm').fill(second.sku);
    const result = page
      .getByRole('list', { name: 'Kết quả tìm kiếm' })
      .getByRole('listitem')
      .filter({ hasText: second.sku });
    await result.getByRole('button', { name: /^Thêm / }).click();
    await expect(items.getByText(second.sku)).toBeVisible();
    await field(page, 'Số nhà, tên đường').fill('99 Nguyễn Huệ');

    await page.getByRole('button', { name: 'Tính lại' }).click();
    const preview = page.getByTestId('order-edit-preview');
    await expect(preview).toBeVisible();
    const subtotal = 2 * first.price + second.price;
    await expect(preview.getByRole('row', { name: /Tạm tính/ })).toContainText(
      new Intl.NumberFormat('vi-VN').format(subtotal),
    );
    await expect(preview).toContainText(`${first.name} 100 ml: 1 → 2`);
    await expect(preview).toContainText(`Thêm ${second.name}`);
    await expect(preview).toContainText('Địa chỉ thay đổi: số nhà, đường');
    await expectNoAxeViolations(page);

    // Editing after the preview invalidates it until it is recomputed.
    await field(page, 'Lý do sửa đơn (hiện trên lịch sử đơn)').fill('Khách gọi điện thêm hàng');
    await expect(
      page.getByText('Đơn đã thay đổi sau lần tính trước. Bấm “Tính lại”.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    await page.getByRole('button', { name: 'Tính lại' }).click();
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled();
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();

    await expect(toast(page, `Đã cập nhật đơn ${order.code}`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: order.code })).toBeVisible();
    const detailItems = page.getByRole('table', { name: 'Sản phẩm' });
    await expect(detailItems).toContainText(second.sku);
    await expect(page.getByText('99 Nguyễn Huệ')).toBeVisible();
    const edited = page.getByRole('listitem').filter({ hasText: 'Khách gọi điện thêm hàng' });
    await expect(edited).toContainText('Sửa đơn');
    await expect(edited).toContainText('2 dòng sản phẩm thay đổi');
    await expect(edited).toContainText('Đổi địa chỉ giao hàng');
    await expectNoAxeViolations(page);

    // Stock deducted for the added units (committed stock, movements written).
    const onHand = await withDb(
      async (db) =>
        (
          await db.query<{ variant_id: string; on_hand: number }>(
            'select variant_id, on_hand from inventory_items where variant_id = any($1::uuid[])',
            [variants.map((v) => v.id)],
          )
        ).rows,
    );
    for (const row of onHand) {
      const before = stockBefore.find((s) => s.variant_id === row.variant_id)!;
      expect(row.on_hand).toBe(before.on_hand - 1);
    }
    expect(errors).toEqual([]);
  });

  test('a concurrent change is refused and a shipped order cannot be edited', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectConsoleErrors(page);
    const order = await confirmedOrder(variants[0], customer);
    created.push(order);
    await signIn(page, staff);
    await page.goto(`/admin/orders/${order.id}/edit`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Sửa đơn ${order.code}` }),
    ).toBeVisible();
    await page
      .getByRole('table', { name: 'Sản phẩm' })
      .getByRole('button', { name: /^Tăng / })
      .click();

    // Someone else changes the order meanwhile.
    await withDb((db) =>
      db.query('update orders set version = version + 1 where id = $1', [order.id]),
    );
    await page.getByRole('button', { name: 'Tính lại' }).click();
    await expect(
      toast(page, 'Dữ liệu vừa được người khác thay đổi. Tải lại trang để xem bản mới nhất.'),
    ).toBeVisible();

    // Shipped: no edit button, and the edit page explains why.
    await withDb((db) =>
      db.query(`update orders set status = 'shipped', shipped_at = now() where id = $1`, [
        order.id,
      ]),
    );
    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByRole('heading', { level: 1, name: order.code })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sửa đơn' })).toHaveCount(0);
    await page.goto(`/admin/orders/${order.id}/edit`);
    await expect(page.getByText(/Không thể sửa đơn ở trạng thái “Đang giao”/)).toBeVisible();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('a manager overrides the shipping fee with a reason', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectConsoleErrors(page);
    const order = await confirmedOrder(variants[1], customer);
    created.push(order);
    await signIn(page, manager);
    await page.goto(`/admin/orders/${order.id}/edit`);
    await page.getByLabel('Ghi đè phí giao hàng', { exact: true }).check();
    await field(page, 'Phí giao hàng (₫)').fill('0');
    await field(page, 'Lý do ghi đè').fill('Khách thân thiết');
    await page.getByRole('button', { name: 'Tính lại' }).click();
    const preview = page.getByTestId('order-edit-preview');
    await expect(preview.getByRole('row', { name: /Phí giao hàng/ })).toContainText('0');
    await expect(preview).toContainText('Phí giao hàng ghi đè');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(toast(page, `Đã cập nhật đơn ${order.code}`)).toBeVisible();
    await expect(page.getByText('Ghi đè phí giao hàng: Khách thân thiết')).toBeVisible();
    const total = await withDb(async (db) =>
      Number(
        (await db.query<{ total: string }>('select total from orders where id = $1', [order.id]))
          .rows[0]!.total,
      ),
    );
    expect(total).toBe(variants[1].price);
    expect(errors).toEqual([]);
  });
});
