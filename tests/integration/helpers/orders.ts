import { asc, eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  orderAddresses,
  orderItems,
  orders,
  productVariants,
  provinces,
  users,
  wards,
} from '@/server/db/schema';
import { newId } from '@/server/lib/ids';
import { generateOrderCode, type OrderStatus } from '@/server/modules/order';

/** Order fixtures for account/notification tests (placeOrder belongs to the checkout stream). */

export async function insertCustomer(db: Database, email: string, locale: 'vi' | 'en' = 'vi') {
  const id = newId();
  await db
    .insert(users)
    .values({ id, email, name: `Customer ${email}`, locale, emailVerified: true });
  return id;
}

export async function insertOrder(
  db: Database,
  input: {
    userId?: string | null;
    status?: OrderStatus;
    phone?: string;
    locale?: 'vi' | 'en';
    paymentMethod?: 'cod' | 'vnpay' | 'payos' | 'bank_transfer';
    total?: number;
    email?: string;
  } = {},
) {
  const [variant] = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
    })
    .from(productVariants)
    .orderBy(asc(productVariants.sku))
    .limit(1);
  const [province] = await db.select().from(provinces).orderBy(asc(provinces.code)).limit(1);
  const [ward] = await db
    .select()
    .from(wards)
    .where(eq(wards.provinceCode, province!.code))
    .limit(1);
  const total = input.total ?? 3_200_000;
  const status = input.status ?? 'pending';
  const id = newId();
  const code = generateOrderCode();
  await db.insert(orders).values({
    id,
    code,
    userId: input.userId ?? null,
    email: input.email ?? 'khach@example.com',
    phone: input.phone ?? '0912345678',
    customerName: 'Nguyễn Thị Hương',
    locale: input.locale ?? 'vi',
    status,
    paymentMethod: input.paymentMethod ?? (status === 'awaiting_confirmation' ? 'cod' : 'vnpay'),
    subtotal: total,
    total,
  });
  await db.insert(orderItems).values({
    orderId: id,
    productId: variant!.productId,
    variantId: variant!.id,
    productName: 'Cèdre Nocturne EDT',
    variantLabel: '100 ml',
    sku: variant!.sku,
    unitPrice: total,
    quantity: 1,
    lineTotal: total,
  });
  await db.insert(orderAddresses).values({
    orderId: id,
    type: 'shipping',
    fullName: 'Nguyễn Thị Hương',
    phone: input.phone ?? '0912345678',
    provinceCode: province!.code,
    provinceName: province!.name,
    wardCode: ward!.code,
    wardName: ward!.name,
    street: '12 Hàng Bạc',
  });
  return { id, code, provinceName: province!.name };
}
