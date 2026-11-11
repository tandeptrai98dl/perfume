import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  addresses,
  consents,
  orderEvents,
  orders,
  provinces,
  users,
  wards,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError } from '@/server/lib/command-context';
import {
  addressSchema,
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  MAX_ADDRESSES,
  profileSchema,
  setDefaultAddress,
  updateAddress,
  updateProfile,
} from '@/server/modules/customer';
import {
  cancelCustomerOrder,
  findOrderCodeForLookup,
  getCustomerOrder,
  getOrderViewByCode,
  listCustomerOrders,
} from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertCustomer, insertOrder } from '../helpers/orders';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let alice: string;
let bob: string;
let provinceA: string;
let wardA: string;
let wardOther: string;

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);
  alice = await insertCustomer(db, 'alice@example.com');
  bob = await insertCustomer(db, 'bob@example.com');
  const [province] = await db.select().from(provinces).orderBy(asc(provinces.code)).limit(1);
  provinceA = province!.code;
  const [ward] = await db.select().from(wards).where(eq(wards.provinceCode, provinceA)).limit(1);
  wardA = ward!.code;
  const [other] = await db.select().from(wards).where(ne(wards.provinceCode, provinceA)).limit(1);
  wardOther = other!.code;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('customer order reads (IDOR protection)', () => {
  it('lists and opens only the customer’s own orders', async () => {
    const mine = await insertOrder(db, { userId: alice });
    const theirs = await insertOrder(db, { userId: bob });
    const guest = await insertOrder(db, { userId: null });

    const list = await listCustomerOrders(db, { userId: alice });
    expect(list.rows.map((row) => row.code)).toEqual([mine.code]);
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ status: 'pending', itemCount: 1, total: 3_200_000 });

    const view = await getCustomerOrder(db, { userId: alice, code: mine.code.toLowerCase() });
    expect(view?.code).toBe(mine.code);
    expect(view?.items).toHaveLength(1);
    expect(view?.shippingAddress?.street).toBe('12 Hàng Bạc');
    expect(view?.timeline).toEqual([{ status: 'pending', at: expect.any(Date) }]);
    expect(view?.canCancel).toBe(true);

    expect(await getCustomerOrder(db, { userId: alice, code: theirs.code })).toBeNull();
    expect(await getCustomerOrder(db, { userId: alice, code: guest.code })).toBeNull();
    expect(await getCustomerOrder(db, { userId: alice, code: "PF-' OR 1=1 --" })).toBeNull();
  });

  it('paginates newest first', async () => {
    const carol = await insertCustomer(db, 'carol@example.com');
    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const order = await insertOrder(db, { userId: carol });
      await db
        .update(orders)
        .set({ placedAt: new Date(Date.UTC(2026, 10, 1 + i)) })
        .where(eq(orders.id, order.id));
      codes.push(order.code);
    }
    const page2 = await listCustomerOrders(db, { userId: carol, page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.rows.map((row) => row.code)).toEqual([codes[0]]);
  });
});

describe('customer cancellation', () => {
  it('cancels a pending order through transitionOrder with a customer actor', async () => {
    const order = await insertOrder(db, { userId: alice });
    const result = await cancelCustomerOrder(db, boss, { userId: alice, code: order.code });
    expect(result).toMatchObject({ from: 'pending', to: 'cancelled' });

    const view = await getCustomerOrder(db, { userId: alice, code: order.code });
    expect(view?.status).toBe('cancelled');
    expect(view?.canCancel).toBe(false);
    expect(view?.timeline.map((entry) => entry.status)).toEqual(['pending', 'cancelled']);
    const [event] = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'status_changed')));
    expect(event).toMatchObject({ actorType: 'customer', actorId: alice, toStatus: 'cancelled' });
    const jobs = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job
          where name = 'order.status-changed' and data->>'orderId' = ${order.id}`,
    );
    expect(jobs.rows[0]!.n).toBe(1);
  });

  it('cancels a COD order awaiting confirmation', async () => {
    const order = await insertOrder(db, { userId: alice, status: 'awaiting_confirmation' });
    await cancelCustomerOrder(db, boss, { userId: alice, code: order.code });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'customer_request' });
  });

  it('refuses once processing has started', async () => {
    const order = await insertOrder(db, { userId: alice, status: 'processing' });
    const error = await rejection(
      cancelCustomerOrder(db, boss, { userId: alice, code: order.code }),
    );
    expect(error.code).toBe('invalid');
    expect(error.fieldErrors).toEqual([{ path: 'status', code: 'notCancellable' }]);
  });

  it('cannot cancel another customer’s order (not found, nothing changes)', async () => {
    const order = await insertOrder(db, { userId: bob });
    const error = await rejection(
      cancelCustomerOrder(db, boss, { userId: alice, code: order.code }),
    );
    expect(error.code).toBe('notFound');
    const [row] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row!.status).toBe('pending');
  });
});

describe('guest order lookup', () => {
  it('needs the order code and the contact or delivery phone', async () => {
    const order = await insertOrder(db, { phone: '+84 912 000 111' });
    expect(await findOrderCodeForLookup(db, { code: order.code, phone: '0912000111' })).toBe(
      order.code,
    );
    expect(
      await findOrderCodeForLookup(db, {
        code: ` ${order.code.toLowerCase()} `,
        phone: '0912000111',
      }),
    ).toBe(order.code);
    expect(await findOrderCodeForLookup(db, { code: order.code, phone: '0912000112' })).toBeNull();
    expect(
      await findOrderCodeForLookup(db, { code: 'PF-000000-AAAA', phone: '0912000111' }),
    ).toBeNull();
    expect((await getOrderViewByCode(db, order.code))?.items[0]?.productName).toBe(
      'Cèdre Nocturne EDT',
    );
  });
});

describe('address book', () => {
  const values = (overrides: Record<string, unknown> = {}) =>
    addressSchema.parse({
      fullName: 'Nguyễn Văn A',
      phone: '0912345678',
      provinceCode: provinceA,
      wardCode: wardA,
      street: '1 Tràng Tiền',
      ...overrides,
    });

  it('makes the first address the default and keeps exactly one default', async () => {
    const user = await insertCustomer(db, 'addr1@example.com');
    const first = await createAddress(db, { userId: user, values: values() });
    const second = await createAddress(db, {
      userId: user,
      values: values({ street: '2 Lê Lợi' }),
    });
    let list = await listAddresses(db, user);
    expect(list.map((a) => [a.id, a.isDefault])).toEqual([
      [first.id, true],
      [second.id, false],
    ]);

    await setDefaultAddress(db, { userId: user, addressId: second.id });
    list = await listAddresses(db, user);
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);

    const third = await createAddress(db, {
      userId: user,
      values: values({ street: '3 Hai Bà Trưng', isDefault: true }),
    });
    list = await listAddresses(db, user);
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([third.id]);

    // Unticking default on the default address keeps it default.
    await updateAddress(db, {
      userId: user,
      addressId: third.id,
      values: values({ street: '3B Hai Bà Trưng', isDefault: false }),
    });
    const updated = await getAddress(db, { userId: user, addressId: third.id });
    expect(updated).toMatchObject({ street: '3B Hai Bà Trưng', isDefault: true });

    // Deleting the default promotes the most recent remaining address.
    await deleteAddress(db, { userId: user, addressId: third.id });
    list = await listAddresses(db, user);
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
  });

  it('rejects a ward outside the chosen province', async () => {
    const user = await insertCustomer(db, 'addr2@example.com');
    const error = await rejection(
      createAddress(db, { userId: user, values: values({ wardCode: wardOther }) }),
    );
    expect(error.fieldErrors).toEqual([{ path: 'wardCode', code: 'wardInvalid' }]);
  });

  it(`stops at ${MAX_ADDRESSES} addresses, also under concurrent requests`, async () => {
    const user = await insertCustomer(db, 'addr3@example.com');
    for (let i = 0; i < MAX_ADDRESSES - 1; i += 1) {
      await createAddress(db, { userId: user, values: values({ street: `${i} Phố Huế` }) });
    }
    const results = await Promise.allSettled([
      createAddress(db, { userId: user, values: values({ street: 'A' }) }),
      createAddress(db, { userId: user, values: values({ street: 'B' }) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as DomainError).fieldErrors).toEqual([
      { path: '', code: 'addressLimit' },
    ]);
    expect(await listAddresses(db, user)).toHaveLength(MAX_ADDRESSES);
  });

  it('never reads or changes another customer’s address', async () => {
    const owner = await insertCustomer(db, 'addr4@example.com');
    const other = await insertCustomer(db, 'addr5@example.com');
    const { id } = await createAddress(db, { userId: owner, values: values() });
    expect(await getAddress(db, { userId: other, addressId: id })).toBeNull();
    for (const attempt of [
      () =>
        updateAddress(db, { userId: other, addressId: id, values: values({ street: 'hacked' }) }),
      () => deleteAddress(db, { userId: other, addressId: id }),
      () => setDefaultAddress(db, { userId: other, addressId: id }),
    ]) {
      expect((await rejection(attempt())).code).toBe('notFound');
    }
    const [row] = await db.select().from(addresses).where(eq(addresses.id, id));
    expect(row!.street).toBe('1 Tràng Tiền');
  });
});

describe('profile', () => {
  it('saves language and appends a consent row only when the opt-in changes', async () => {
    const user = await insertCustomer(db, 'profile@example.com');
    const base = { name: 'Hương', phone: '+84912345678', birthday: '1990-05-17', locale: 'en' };
    await updateProfile(db, {
      userId: user,
      values: profileSchema.parse({ ...base, marketingOptIn: true }),
      context: { ip: '203.0.113.9', userAgent: 'vitest' },
    });
    await updateProfile(db, {
      userId: user,
      values: profileSchema.parse({ ...base, marketingOptIn: true }),
    });
    await updateProfile(db, {
      userId: user,
      values: profileSchema.parse({ ...base, marketingOptIn: false }),
    });

    const [row] = await db.select().from(users).where(eq(users.id, user));
    expect(row).toMatchObject({
      locale: 'en',
      phone: '0912345678',
      birthday: '1990-05-17',
      marketingOptIn: false,
    });
    const rows = await db
      .select({ granted: consents.granted, purpose: consents.purpose, source: consents.source })
      .from(consents)
      .where(eq(consents.userId, user))
      .orderBy(asc(consents.createdAt), asc(consents.id));
    expect(rows).toEqual([
      { granted: true, purpose: 'marketing_email', source: 'account_profile' },
      { granted: false, purpose: 'marketing_email', source: 'account_profile' },
    ]);
  });
});
