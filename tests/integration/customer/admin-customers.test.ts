import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, orderEvents, orders, refunds, users } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  addCustomerNote,
  customerListSchema,
  exportCustomersCsv,
  getCustomerDetail,
  listCustomers,
  listCustomersForExport,
  setCodRiskFlag,
  type CustomerListQuery,
} from '@/server/modules/customer';
import { generateOrderCode } from '@/server/modules/order';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

/*
 * Admin customers (§11.2): lifetime spend net of refunds, guest grouping by phone, search,
 * filters and masking, COD risk flag with reason (audited), audit-backed notes and the
 * Owner-only CSV export.
 */

let h: CommandHarness;
let huong: string;

type OrderInput = {
  userId?: string | null;
  phone: string;
  email?: string;
  name?: string;
  status: (typeof orders.status.enumValues)[number];
  total: number;
  refunded?: number;
  placedAt?: Date;
  failedDelivery?: boolean;
};

async function order(input: OrderInput) {
  const id = newId();
  await h.db.insert(orders).values({
    id,
    code: generateOrderCode(),
    userId: input.userId ?? null,
    email: input.email ?? '',
    phone: input.phone,
    customerName: input.name ?? 'Khách',
    locale: 'vi',
    status: input.status,
    paymentMethod: 'cod',
    subtotal: input.total,
    total: input.total,
    amountPaid: input.refunded ?? 0,
    amountRefunded: input.refunded ?? 0,
    placedAt: input.placedAt ?? new Date(),
  });
  if (input.refunded) {
    await h.db.insert(refunds).values({
      orderId: id,
      amount: input.refunded,
      reason: 'test',
      method: 'cash',
      status: 'completed',
      actorId: h.actorIds.owner,
    });
  }
  if (input.failedDelivery) {
    await h.db.insert(orderEvents).values({
      orderId: id,
      type: 'status_changed',
      fromStatus: 'shipped',
      toStatus: 'delivery_failed',
      actorType: 'staff',
    });
  }
  return id;
}

async function customer(name: string, email: string, phone: string | null, codRiskFlag = false) {
  const id = newId();
  await h.db.insert(users).values({ id, name, email, phone, codRiskFlag });
  return id;
}

const query = (input: Partial<CustomerListQuery> = {}) => customerListSchema.parse(input);
const visible = { contactVisible: true };

beforeAll(async () => {
  h = await startCommandHarness();
  huong = await customer('Nguyễn Thị Hương', 'huong@example.com', '0912345678');
  await customer('Trần Văn Bom', 'bom@example.com', '0987000111', true);
  await customer('=HYPERLINK("http://evil")', 'formula@example.com', null);
  const day = 24 * 3600_000;
  await order({
    userId: huong,
    phone: '0912345678',
    status: 'completed',
    total: 3_200_000,
    refunded: 200_000,
    placedAt: new Date(Date.now() - 5 * day),
  });
  await order({
    userId: huong,
    phone: '0912345678',
    status: 'delivered',
    total: 1_500_000,
    placedAt: new Date(Date.now() - 3 * day),
  });
  await order({ userId: huong, phone: '0912345678', status: 'cancelled', total: 9_000_000 });
  await order({ userId: huong, phone: '0912345678', status: 'pending', total: 700_000 });
  await order({
    userId: huong,
    phone: '0912345678',
    status: 'returned',
    total: 2_000_000,
    failedDelivery: true,
    placedAt: new Date(Date.now() - 4 * day),
  });
  // Guest contact: two orders on one phone, latest name wins; one anonymised guest order.
  await order({
    phone: '0901222333',
    email: 'an@example.com',
    name: 'Lê An',
    status: 'completed',
    total: 5_000_000,
    placedAt: new Date(Date.now() - 10 * day),
  });
  await order({
    phone: '0901222333',
    email: 'an.le@example.com',
    name: 'Lê Thị An',
    status: 'confirmed',
    total: 1_000_000,
    failedDelivery: true,
  });
  await order({
    phone: '',
    email: '',
    name: '[anonymized]',
    status: 'completed',
    total: 4_000_000,
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('listCustomers', () => {
  it('aggregates orders: count, lifetime spend net of refunds, last order, failed deliveries', async () => {
    const page = await listCustomers(h.db, query({ q: 'huong@example.com' }), visible);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      key: huong,
      type: 'registered',
      name: 'Nguyễn Thị Hương',
      phone: '0912345678',
      email: 'huong@example.com',
      orderCount: 5,
      // completed 3.2M − 0.2M refunded + delivered 1.5M; cancelled/pending/returned excluded.
      lifetimeSpend: 4_500_000,
      failedDeliveries: 1,
      codRiskFlag: false,
    });
    expect(Number.isInteger(page.rows[0]!.lifetimeSpend)).toBe(true);
    expect(page.rows[0]!.lastOrderAt).toBeInstanceOf(Date);
  });

  it('groups guest orders by phone and skips anonymised orders', async () => {
    const page = await listCustomers(h.db, query({ type: 'guest' }), visible);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      type: 'guest',
      name: 'Lê Thị An',
      phone: '0901222333',
      email: 'an.le@example.com',
      orderCount: 2,
      lifetimeSpend: 6_000_000,
      failedDeliveries: 1,
    });
    expect(page.rows[0]!.key).toMatch(/^g-/);
  });

  it('searches by e-mail or phone prefix and by name word prefix without accents', async () => {
    const keys = async (q: string) =>
      (await listCustomers(h.db, query({ q }), visible)).rows.map((row) => row.name);
    expect(await keys('huong@')).toEqual(['Nguyễn Thị Hương']);
    expect(await keys('+84 90122')).toEqual(['Lê Thị An']);
    expect(await keys('0987000111')).toEqual(['Trần Văn Bom']);
    expect(await keys('huon')).toEqual(['Nguyễn Thị Hương']);
    expect(await keys('thi')).toEqual(expect.arrayContaining(['Nguyễn Thị Hương', 'Lê Thị An']));
    expect(await keys('guyen')).toEqual([]);
    expect(await keys('100%')).toEqual([]);
  });

  it('filters risky customers (flag or failed delivery) and sorts by spend', async () => {
    const risky = await listCustomers(
      h.db,
      query({ risk: 'flagged', sort: 'spend', dir: 'desc' }),
      visible,
    );
    expect(risky.rows.map((row) => row.name)).toEqual([
      'Lê Thị An',
      'Nguyễn Thị Hương',
      'Trần Văn Bom',
    ]);
    const registered = await listCustomers(
      h.db,
      query({ type: 'registered', sort: 'name', dir: 'asc' }),
      visible,
    );
    expect(registered.total).toBe(3);
  });

  it('masks phone and e-mail when the role may not see contact details', async () => {
    const page = await listCustomers(h.db, query({ q: 'huong@example.com' }), {
      contactVisible: false,
    });
    expect(page.rows[0]).toMatchObject({
      phone: '091****678',
      email: 'h***@example.com',
      contactMasked: true,
    });
  });
});

describe('getCustomerDetail', () => {
  it('returns orders, stats and phone-based failed deliveries for an account', async () => {
    const detail = await getCustomerDetail(h.db, { type: 'user', id: huong }, visible);
    expect(detail).toMatchObject({
      type: 'registered',
      userId: huong,
      stats: { orderCount: 5, lifetimeSpend: 4_500_000, failedDeliveries: 1 },
      phoneFailedDeliveries: 1,
      codRiskFlag: false,
    });
    expect(detail!.orders).toHaveLength(5);
    expect(detail!.orders.filter((row) => row.failedDelivery)).toHaveLength(1);
  });

  it('groups a guest contact from any of its orders', async () => {
    const [guestOrder] = await h.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.phone, '0901222333'), eq(orders.customerName, 'Lê An')));
    const detail = await getCustomerDetail(
      h.db,
      { type: 'guest', orderId: guestOrder!.id },
      { contactVisible: false },
    );
    expect(detail).toMatchObject({
      type: 'guest',
      userId: null,
      name: 'Lê Thị An',
      phone: '090****333',
      stats: { orderCount: 2, lifetimeSpend: 6_000_000 },
    });
  });

  it('is null for staff accounts and unknown keys', async () => {
    expect(
      await getCustomerDetail(h.db, { type: 'user', id: h.actorIds.owner }, visible),
    ).toBeNull();
    expect(await getCustomerDetail(h.db, { type: 'guest', orderId: newId() }, visible)).toBeNull();
  });
});

describe('COD risk flag and notes', () => {
  it('sets and clears the flag with a reason, audited, and refuses no-ops and other roles', async () => {
    await setCodRiskFlag(h.ctx('manager'), {
      userId: huong,
      flagged: true,
      reason: 'Từ chối nhận hàng 2 lần',
    });
    let [row] = await h.db
      .select({ flag: users.codRiskFlag })
      .from(users)
      .where(eq(users.id, huong));
    expect(row!.flag).toBe(true);

    await expect(
      setCodRiskFlag(h.ctx('manager'), { userId: huong, flagged: true, reason: 'lặp lại' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      setCodRiskFlag(h.ctx('staff'), { userId: huong, flagged: false, reason: 'không có quyền' }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      setCodRiskFlag(h.ctx('owner'), {
        userId: h.actorIds.editor,
        flagged: true,
        reason: 'nhân viên',
      }),
    ).rejects.toMatchObject({ code: 'notFound' });

    await setCodRiskFlag(h.ctx('owner'), {
      userId: huong,
      flagged: false,
      reason: 'Đã gọi xác nhận lại',
    });
    [row] = await h.db.select({ flag: users.codRiskFlag }).from(users).where(eq(users.id, huong));
    expect(row!.flag).toBe(false);

    const audit = await h.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'customer.codRiskFlag'), eq(auditLogs.entityId, huong)));
    expect(audit).toHaveLength(2);
    expect(audit.map((entry) => entry.diff)).toEqual(
      expect.arrayContaining([
        {
          codRiskFlag: { from: false, to: true },
          reason: { from: null, to: 'Từ chối nhận hàng 2 lần' },
        },
        {
          codRiskFlag: { from: true, to: false },
          reason: { from: null, to: 'Đã gọi xác nhận lại' },
        },
      ]),
    );
  });

  it('stores notes as audit rows and shows notes and risk changes newest first', async () => {
    await addCustomerNote(h.ctx('manager'), {
      userId: huong,
      note: 'Khách thích giao giờ hành chính',
    });
    await expect(
      addCustomerNote(h.ctx('editor'), { userId: huong, note: 'x' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const detail = await getCustomerDetail(h.db, { type: 'user', id: huong }, visible);
    expect(
      detail!.history.map((entry) => [entry.kind, entry.text, entry.flagged, entry.actorName]),
    ).toEqual([
      ['note', 'Khách thích giao giờ hành chính', null, 'manager'],
      ['risk', 'Đã gọi xác nhận lại', false, 'owner'],
      ['risk', 'Từ chối nhận hàng 2 lần', true, 'manager'],
    ]);
  });
});

describe('exportCustomersCsv', () => {
  it('is Owner only, formula-safe and audited without customer data', async () => {
    await expect(exportCustomersCsv(h.ctx('manager'), query())).rejects.toMatchObject({
      code: 'forbidden',
    });

    const { csv, rows, truncated } = await exportCustomersCsv(
      h.ctx('owner'),
      customerListSchema.parse({ sort: 'name', dir: 'asc' }),
    );
    expect(rows).toBe(4);
    expect(truncated).toBe(false);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'customer_key,type,name,phone,email,locale,orders,lifetime_spend_vnd,last_order_at,failed_deliveries,cod_risk_flag,customer_since',
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('huong@example.com');
    expect(csv).toContain(',4500000,');

    const [audit] = await h.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'customer.export'));
    expect(audit).toMatchObject({ actorId: h.actorIds.owner, entityType: 'user', entityId: null });
    expect(audit!.diff).toMatchObject({
      rows: 4,
      truncated: false,
      filter: { sort: 'name', dir: 'asc' },
    });
    expect(JSON.stringify(audit!.diff)).not.toContain('huong');
  });

  it('caps the rows and reports truncation', async () => {
    const result = await listCustomersForExport(h.db, query(), { contactVisible: true, limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
