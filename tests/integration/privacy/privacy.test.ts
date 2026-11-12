import { and, asc, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { render, toPlainText } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  addresses,
  auditLogs,
  carts,
  consents,
  orderAddresses,
  orderEvents,
  orders,
  privacyRequests,
  provinces,
  sessions,
  users,
  wards,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createEmailSender, type EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError, type CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  anonymizePrivacySubject,
  buildPersonalDataExport,
  confirmGuestPrivacyRequest,
  getConsentState,
  listPrivacyRequests,
  recordCookieChoice,
  requestAccountPrivacy,
  setPrivacyRequestStatus,
  signGuestRequest,
  startGuestPrivacyRequest,
  updateAccountConsents,
  verifyExportLink,
} from '@/server/modules/customer';
import { ANONYMIZED_TEXT } from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertCustomer, insertOrder } from '../helpers/orders';

const SECRET = 'privacy-link-secret-privacy-link-secret';
const APP_URL = 'https://shop.example';
const CONTEXT = { ip: '203.113.45.0', userAgent: 'vitest' };

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let handlers: JobHandlers;
let ownerId: string;
let managerId: string;
type Sent = { to: string; subject: string; text: string };
let sent: Sent[];

function captureSender(): EmailSender {
  const real = createEmailSender({
    transport: nodemailer.createTransport({ jsonTransport: true }),
    from: 'Perfume Store <no-reply@example.com>',
  });
  return {
    async send(message) {
      const html = await render(message.template);
      sent.push({
        to: message.to,
        subject: message.subject,
        text: toPlainText(html).replace(/ /g, ' '),
      });
      return real.send(message);
    },
    close: () => real.close(),
  };
}

function ctx(actorId: string, role: string): CommandContext {
  return { db, boss, actor: { id: actorId, role }, ip: '127.0.0.1' };
}

async function jobs(name: string): Promise<Record<string, unknown>[]> {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on, id`,
  );
  return result.rows.map((row) => row.data);
}

/** Runs every queued job of `name` once through the real handlers, then deletes them. */
async function drain(name: 'privacy.notify' | 'privacy.export' | 'privacy.verify-request') {
  for (const data of await jobs(name)) {
    await (handlers[name] as (payload: unknown) => Promise<void>)(data);
  }
  await db.execute(sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name}`);
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

async function addAddress(userId: string) {
  const [province] = await db.select().from(provinces).orderBy(asc(provinces.code)).limit(1);
  const [ward] = await db
    .select()
    .from(wards)
    .where(eq(wards.provinceCode, province!.code))
    .limit(1);
  await db.insert(addresses).values({
    userId,
    fullName: 'Trần Văn Bình',
    phone: '0901234567',
    provinceCode: province!.code,
    wardCode: ward!.code,
    street: '5 Nguyễn Huệ',
  });
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
  handlers = createHandlers({
    db,
    boss,
    email: captureSender(),
    internalBaseUrl: APP_URL,
    internalSecret: SECRET,
    appUrl: APP_URL,
    orderLinkSecret: SECRET,
    chat: null,
  });
  ownerId = newId();
  managerId = newId();
  await db.insert(users).values([
    { id: ownerId, name: 'Owner', email: 'owner@example.com', role: 'owner' },
    { id: managerId, name: 'Manager', email: 'manager@example.com', role: 'manager' },
  ]);
});

beforeEach(() => {
  sent = [];
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('consent log (append-only)', () => {
  it('records cookie choices with a receipt id and never rewrites earlier rows', async () => {
    const receipt = await recordCookieChoice(db, {
      analytics: true,
      ads: false,
      userId: null,
      locale: 'vi',
      source: 'cookie_banner',
      policyVersion: '2026-11-01',
      context: CONTEXT,
    });
    const first = await db.select().from(consents).where(eq(consents.id, receipt));
    expect(first[0]).toMatchObject({ purpose: 'analytics', granted: true, ip: CONTEXT.ip });

    const later = await recordCookieChoice(db, {
      analytics: false,
      ads: false,
      userId: null,
      locale: 'vi',
      source: 'cookie_preferences',
      policyVersion: '2026-11-01',
      context: CONTEXT,
    });
    expect(later).not.toBe(receipt);
    const again = await db.select().from(consents).where(eq(consents.id, receipt));
    expect(again).toEqual(first);
  });

  it('appends one row per changed purpose from the privacy centre and syncs the opt-in', async () => {
    const userId = await insertCustomer(db, 'consent@example.com');
    const before = await db.select().from(consents).where(eq(consents.userId, userId));
    expect(before).toHaveLength(0);

    const values = {
      locale: 'vi' as const,
      marketingEmail: true,
      marketingSms: false,
      analytics: true,
      ads: false,
    };
    const first = await updateAccountConsents(db, {
      userId,
      values,
      cookieChoice: null,
      context: CONTEXT,
    });
    expect(first.changed.sort()).toEqual(['analytics', 'marketing_email']);
    // marketing_email changed + analytics/ads logged as the device's first answer.
    expect(await db.select().from(consents).where(eq(consents.userId, userId))).toHaveLength(3);

    const second = await updateAccountConsents(db, {
      userId,
      values: { ...values, marketingEmail: false },
      cookieChoice: { analytics: true, ads: false },
      context: CONTEXT,
    });
    expect(second.changed).toEqual(['marketing_email']);
    const rows = await db
      .select()
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.purpose, 'marketing_email')))
      .orderBy(asc(consents.createdAt), asc(consents.id));
    expect(rows.map((row) => row.granted)).toEqual([true, false]);
    const state = await getConsentState(db, userId);
    expect(state.marketing_email.granted).toBe(false);
    expect(state.analytics.granted).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.marketingOptIn).toBe(false);
  });
});

describe('data export', () => {
  it('files one export per person, completes it in the worker and e-mails a signed link', async () => {
    const userId = await insertCustomer(db, 'export@example.com', 'en');
    await addAddress(userId);
    const own = await insertOrder(db, { userId, email: 'export@example.com', status: 'completed' });
    const guestOrder = await insertOrder(db, { email: 'export@example.com', status: 'cancelled' });
    const other = await insertOrder(db, { email: 'someone-else@example.com' });

    const { request, created } = await requestAccountPrivacy(db, boss, {
      userId,
      values: { type: 'export', locale: 'en' },
    });
    expect(created).toBe(true);
    expect(request.dueAt.getTime() - request.createdAt.getTime()).toBeCloseTo(
      10 * 24 * 3600_000,
      -4,
    );
    const duplicate = await requestAccountPrivacy(db, boss, {
      userId,
      values: { type: 'export', locale: 'en' },
    });
    expect(duplicate).toMatchObject({ created: false, request: { id: request.id } });
    expect(await jobs('privacy.export')).toEqual([{ requestId: request.id }]);
    expect(await jobs('privacy.notify')).toEqual([]);

    await drain('privacy.export');
    const [row] = await db.select().from(privacyRequests).where(eq(privacyRequests.id, request.id));
    expect(row).toMatchObject({ status: 'completed' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('export@example.com');
    expect(sent[0]!.subject).toBe('Your personal data is ready');
    const link = new URL(
      sent[0]!.text.match(/https:\/\/shop\.example\/api\/privacy\/export\/\S+/)![0],
    );
    expect(link.pathname).toBe(`/api/privacy/export/${request.id}`);
    expect(
      verifyExportLink(SECRET, request.id, link.searchParams.get('e'), link.searchParams.get('t')),
    ).toBe(true);

    const data = await buildPersonalDataExport(db, { userId, email: 'export@example.com' });
    expect(data.format).toBe('perfume-store.personal-data.v1');
    expect(data.account).toMatchObject({ email: 'export@example.com', locale: 'en' });
    expect(data.addresses).toHaveLength(1);
    expect(data.orders.map((order) => order.code).sort()).toEqual(
      [own.code, guestOrder.code].sort(),
    );
    expect(data.orders.map((order) => order.code)).not.toContain(other.code);
    expect(data.orders[0]).toMatchObject({ contact: { email: 'export@example.com' } });
    expect(data.privacyRequests).toHaveLength(1);
    // No internal staff notes in the export.
    expect(JSON.stringify(data)).not.toContain('internalNote');
  });
});

describe('guest requests', () => {
  it('sends a confirmation link and files the request only when confirmed', async () => {
    await startGuestPrivacyRequest(db, boss, {
      values: { email: 'guest@example.com', type: 'correct', details: 'Sai tên', locale: 'vi' },
      secret: SECRET,
      appUrl: APP_URL,
    });
    expect(
      await db.select().from(privacyRequests).where(eq(privacyRequests.email, 'guest@example.com')),
    ).toHaveLength(0);
    const [job] = await jobs('privacy.verify-request');
    const url = new URL(job!.url as string);
    expect(url.pathname).toBe('/quyen-rieng-tu/yeu-cau/xac-nhan');
    await drain('privacy.verify-request');
    expect(sent[0]).toMatchObject({ to: 'guest@example.com' });

    const token = url.searchParams.get('token')!;
    const first = await confirmGuestPrivacyRequest(db, boss, { token, secret: SECRET });
    expect(first).toMatchObject({ created: true, request: { type: 'correct', note: 'Sai tên' } });
    const second = await confirmGuestPrivacyRequest(db, boss, { token, secret: SECRET });
    expect(second).toMatchObject({ created: false, request: { id: first.request.id } });
    await drain('privacy.notify');
    expect(sent.at(-1)!.subject).toBe('Chúng tôi đã nhận yêu cầu của bạn');

    const invalid = await rejection(
      confirmGuestPrivacyRequest(db, boss, { token: `${token}x`, secret: SECRET }),
    );
    expect(invalid.fieldErrors).toEqual([{ path: 'token', code: 'tokenInvalid' }]);
  });

  it('carries out a withdrawal of marketing consent at once', async () => {
    const userId = await insertCustomer(db, 'optout@example.com');
    await db.update(users).set({ marketingOptIn: true }).where(eq(users.id, userId));
    const token = signGuestRequest(SECRET, {
      email: 'optout@example.com',
      type: 'withdraw_consent',
      locale: 'vi',
      details: null,
    });
    const { request } = await confirmGuestPrivacyRequest(db, boss, { token, secret: SECRET });
    expect(request).toMatchObject({ status: 'completed', userId });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.marketingOptIn).toBe(false);
    const rows = await db
      .select({ purpose: consents.purpose, granted: consents.granted })
      .from(consents)
      .where(eq(consents.email, 'optout@example.com'));
    expect(rows).toEqual(
      expect.arrayContaining([
        { purpose: 'marketing_email', granted: false },
        { purpose: 'marketing_sms', granted: false },
      ]),
    );
    await drain('privacy.notify');
    expect(sent.at(-1)!.subject).toBe('Yêu cầu của bạn đã được xử lý');
  });
});

describe('anonymisation', () => {
  it('refuses while orders are open, for staff accounts and without the typed e-mail', async () => {
    const userId = await insertCustomer(db, 'busy@example.com');
    await insertOrder(db, { userId, email: 'busy@example.com', status: 'shipped' });
    const { request } = await requestAccountPrivacy(db, boss, {
      userId,
      values: { type: 'delete', locale: 'vi' },
    });
    const mismatch = await rejection(
      anonymizePrivacySubject(ctx(ownerId, 'owner'), { id: request.id, confirmEmail: 'x@y.z' }),
    );
    expect(mismatch.fieldErrors[0]?.code).toBe('confirmMismatch');
    const open = await rejection(
      anonymizePrivacySubject(ctx(ownerId, 'owner'), {
        id: request.id,
        confirmEmail: 'busy@example.com',
      }),
    );
    expect(open).toMatchObject({ code: 'conflict', fieldErrors: [{ code: 'openOrders' }] });
    const manager = await rejection(
      anonymizePrivacySubject(ctx(managerId, 'manager'), {
        id: request.id,
        confirmEmail: 'busy@example.com',
      }),
    );
    expect(manager.code).toBe('forbidden');

    const staffRequest = await db
      .insert(privacyRequests)
      .values({
        userId: managerId,
        email: 'manager@example.com',
        type: 'delete',
        dueAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: privacyRequests.id });
    const staff = await rejection(
      anonymizePrivacySubject(ctx(ownerId, 'owner'), {
        id: staffRequest[0]!.id,
        confirmEmail: 'manager@example.com',
      }),
    );
    expect(staff.fieldErrors[0]?.code).toBe('staffAccount');
  });

  it('removes personal data, keeps accounting data and scrubs order edit diffs', async () => {
    const email = 'leaving@example.com';
    const userId = await insertCustomer(db, email);
    await db
      .update(users)
      .set({ phone: '0911222333', marketingOptIn: true })
      .where(eq(users.id, userId));
    await addAddress(userId);
    await db.insert(sessions).values({
      userId,
      token: `session-${userId}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(carts).values({ userId, expiresAt: new Date(Date.now() + 86_400_000) });
    const order = await insertOrder(db, { userId, email, status: 'completed', total: 2_500_000 });
    const guestOrder = await insertOrder(db, { email, status: 'cancelled' });
    const untouched = await insertOrder(db, { email: 'stays@example.com', status: 'completed' });
    await db
      .update(orders)
      .set({
        customerNote: 'Gọi trước khi giao',
        ipAddress: '203.113.45.67',
        vatInvoice: { companyName: 'Công ty A', taxCode: '0101234567', address: 'HN', email },
      })
      .where(eq(orders.id, order.id));
    await db.insert(orderEvents).values({
      orderId: order.id,
      type: 'edited',
      actorType: 'staff',
      diff: {
        address: {
          street: { from: '12 Hàng Bạc', to: '14 Hàng Bạc' },
          phone: { from: '0912345678', to: '0911222333' },
        },
        totals: { total: { from: 2_000_000, to: 2_500_000 } },
      },
    });
    await db.insert(consents).values({
      userId,
      email,
      phone: '0911222333',
      purpose: 'marketing_email',
      granted: true,
      policyVersion: '2026-11-01',
      locale: 'vi',
      source: 'checkout',
      ip: '203.113.45.67',
    });

    const { request } = await requestAccountPrivacy(db, boss, {
      userId,
      values: { type: 'delete', locale: 'vi', details: null },
    });
    const result = await anonymizePrivacySubject(ctx(ownerId, 'owner'), {
      id: request.id,
      confirmEmail: email.toUpperCase(),
    });
    expect(result.data).toEqual({ ordersAnonymized: 2, accountAnonymized: true });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({
      name: '[anonymized]',
      email: `deleted+${userId}@anonymized.invalid`,
      phone: null,
      banned: true,
      marketingOptIn: false,
    });
    expect(user!.deletedAt).not.toBeNull();
    expect(await db.select().from(addresses).where(eq(addresses.userId, userId))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await db.select().from(carts).where(eq(carts.userId, userId))).toHaveLength(0);

    const [kept] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(kept).toMatchObject({
      customerName: ANONYMIZED_TEXT,
      phone: '',
      customerNote: null,
      ipAddress: null,
      total: 2_500_000,
      status: 'completed',
      code: order.code,
      vatInvoice: { companyName: 'Công ty A', taxCode: '0101234567', address: 'HN' },
    });
    expect(kept!.email).not.toContain('leaving');
    const [guestKept] = await db.select().from(orders).where(eq(orders.id, guestOrder.id));
    expect(guestKept!.customerName).toBe(ANONYMIZED_TEXT);
    const [other] = await db.select().from(orders).where(eq(orders.id, untouched.id));
    expect(other!.email).toBe('stays@example.com');

    const [address] = await db
      .select()
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, order.id));
    expect(address).toMatchObject({
      fullName: ANONYMIZED_TEXT,
      phone: '',
      street: ANONYMIZED_TEXT,
    });
    expect(address!.provinceName).not.toBe('');
    const [edited] = await db
      .select({ diff: orderEvents.diff })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'edited')));
    expect(edited!.diff).toEqual({
      address: {
        street: { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT },
        phone: { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT },
      },
      totals: { total: { from: 2_000_000, to: 2_500_000 } },
    });

    const consentRows = await db.select().from(consents).where(eq(consents.userId, userId));
    expect(consentRows.length).toBeGreaterThan(1);
    for (const row of consentRows) {
      expect(row).toMatchObject({ email: null, phone: null, ip: null, userAgent: null });
    }
    expect(consentRows.filter((row) => row.source === 'privacy_erasure')).toHaveLength(2);

    const [done] = await db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, request.id));
    expect(done).toMatchObject({ status: 'completed', handledBy: ownerId, email });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, request.id), eq(auditLogs.action, 'privacy_request.anonymized')),
      );
    expect(audit[0]!.diff).toMatchObject({ ordersAnonymized: 2, accountAnonymized: true });
    expect(JSON.stringify(audit[0]!.diff)).not.toContain(email);

    await drain('privacy.notify');
    expect(sent.at(-1)).toMatchObject({ to: email, subject: 'Yêu cầu của bạn đã được xử lý' });

    // The export of the same e-mail now contains nothing personal.
    const data = await buildPersonalDataExport(db, { userId, email });
    expect(data.account).toMatchObject({ name: '[anonymized]' });
    for (const exported of data.orders) {
      expect(exported.contact).toMatchObject({ name: ANONYMIZED_TEXT, phone: '' });
    }
    expect(JSON.stringify(data)).not.toContain('0911222333');
  });
});

describe('admin queue', () => {
  it('lists open requests by due date and needs a reason to reject', async () => {
    const userId = await insertCustomer(db, 'queue@example.com');
    const { request } = await requestAccountPrivacy(db, boss, {
      userId,
      values: { type: 'correct', locale: 'vi', details: 'Đổi tên trên đơn' },
    });
    const list = await listPrivacyRequests(db, { filter: 'open', q: 'queue@' });
    expect(list.rows.map((row) => row.id)).toEqual([request.id]);
    const overdue = await listPrivacyRequests(db, {
      filter: 'overdue',
      q: 'queue@',
    });
    expect(overdue.total).toBe(0);
    expect(
      (
        await listPrivacyRequests(
          db,
          { filter: 'open', q: 'queue@' },
          new Date(Date.now() + 11 * 86_400_000),
        )
      ).rows[0]!.overdue,
    ).toBe(true);

    const noReason = await rejection(
      setPrivacyRequestStatus(ctx(ownerId, 'owner'), { id: request.id, status: 'rejected' }),
    );
    expect(noReason.fieldErrors[0]?.code).toBe('rejectReasonRequired');
    const forbidden = await rejection(
      setPrivacyRequestStatus(ctx(managerId, 'manager'), { id: request.id, status: 'in_progress' }),
    );
    expect(forbidden.code).toBe('forbidden');

    await setPrivacyRequestStatus(ctx(ownerId, 'owner'), { id: request.id, status: 'in_progress' });
    await setPrivacyRequestStatus(ctx(ownerId, 'owner'), {
      id: request.id,
      status: 'rejected',
      note: 'Thông tin trên hoá đơn đã xuất không thể sửa.',
    });
    const closed = await rejection(
      setPrivacyRequestStatus(ctx(ownerId, 'owner'), { id: request.id, status: 'completed' }),
    );
    expect(closed.code).toBe('conflict');
    const audit = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, request.id))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
    expect(audit.map((row) => row.action)).toEqual([
      'privacy_request.created',
      'privacy_request.in_progress',
      'privacy_request.rejected',
    ]);
    await drain('privacy.notify');
    expect(sent.at(-1)!.text).toContain('Thông tin trên hoá đơn đã xuất không thể sửa.');
  });
});
