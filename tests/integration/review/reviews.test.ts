import { and, asc, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { render } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  auditLogs,
  orderItems,
  orders,
  products,
  productVariants,
  reviewInvitations,
  reviews,
  users,
  wishlists,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createEmailSender, type EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError, type CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  MAX_WISHLIST_ITEMS,
  listWishlistProductIds,
  setWishlisted,
} from '@/server/modules/customer';
import {
  countReviewsByStatus,
  getInvitationByToken,
  getReviewSummary,
  hashReviewToken,
  listMemberReviews,
  listPublishedReviews,
  listReviewableItems,
  listReviewsForModeration,
  moderateReview,
  replyToReview,
  reviewTags,
  sendReviewInvitations,
  submitGuestReview,
  submitMemberReview,
  type ReviewFormValues,
} from '@/server/modules/review';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertCustomer, insertOrder } from '../helpers/orders';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let handlers: JobHandlers;
let sent: { to: string; subject: string; html: string }[];
let failNextEmail = 0;
const staff: Record<'owner' | 'editor' | 'staff', string> = { owner: '', editor: '', staff: '' };

const APP_URL = 'https://shop.test';

function captureSender(): EmailSender {
  const real = createEmailSender({
    transport: nodemailer.createTransport({ jsonTransport: true }),
    from: 'Perfume Store <no-reply@example.com>',
  });
  return {
    async send(message) {
      if (failNextEmail > 0) {
        failNextEmail -= 1;
        throw new Error('SMTP unavailable');
      }
      sent.push({ to: message.to, subject: message.subject, html: await render(message.template) });
      return real.send(message);
    },
    close: () => real.close(),
  };
}

const deps = () => ({ db, email: captureSender(), appUrl: APP_URL });

function ctx(role: keyof typeof staff): CommandContext {
  return { db, boss, actor: { id: staff[role], role }, ip: '127.0.0.1' };
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

const values = (overrides: Partial<ReviewFormValues> = {}): ReviewFormValues => ({
  rating: 5,
  longevity: 4,
  sillage: 3,
  title: 'Ấm và sang',
  body: 'Mùi gỗ tuyết tùng ấm áp, lưu hương cả ngày dài.',
  reviewerName: 'Hương',
  ...overrides,
});

/** Second line on an order, using another variant (another product when possible). */
async function addLine(orderId: string) {
  const [first] = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const [variant] = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
    })
    .from(productVariants)
    .where(sql`${productVariants.productId} <> ${first!.productId}`)
    .orderBy(asc(productVariants.sku))
    .limit(1);
  const [row] = await db
    .insert(orderItems)
    .values({
      orderId,
      productId: variant!.productId,
      variantId: variant!.id,
      productName: 'Ambre Soie EDP',
      variantLabel: '50 ml',
      sku: variant!.sku,
      unitPrice: 2_000_000,
      quantity: 1,
      lineTotal: 2_000_000,
    })
    .returning({ id: orderItems.id });
  return row!.id;
}

async function lineOf(orderId: string) {
  const [row] = await db
    .select({ id: orderItems.id, productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
    .limit(1);
  return row!;
}

function tokensIn(html: string): string[] {
  return [
    ...html.matchAll(/\/danh-gia\/([A-Za-z0-9_-]{43})|\/en\/review\/([A-Za-z0-9_-]{43})/g),
  ].map((m) => (m[1] ?? m[2])!);
}

async function jobs(name: string) {
  const result = await db.execute<{ data: Record<string, unknown>; start_after: Date }>(
    sql`select data, start_after from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on`,
  );
  return result.rows;
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
  for (const role of Object.keys(staff) as (keyof typeof staff)[]) {
    const id = newId();
    staff[role] = id;
    await db.insert(users).values({ id, name: role, email: `${role}-reviews@example.com`, role });
  }
  handlers = createHandlers({
    db,
    boss,
    email: captureSender(),
    appUrl: APP_URL,
    internalBaseUrl: 'http://web.internal',
    internalSecret: 'x'.repeat(32),
    chat: null,
  });
});

beforeEach(() => {
  sent = [];
  failNextEmail = 0;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('member reviews', () => {
  it('lets a member review each delivered line once, from the account', async () => {
    const userId = await insertCustomer(db, 'member-review@example.com');
    const order = await insertOrder(db, { userId, status: 'delivered' });
    const second = await addLine(order.id);
    const line = await lineOf(order.id);

    const before = await listReviewableItems(db, { userId, locale: 'vi' });
    expect(before.map((item) => item.orderItemId).sort()).toEqual([line.id, second].sort());

    const { id } = await submitMemberReview(db, {
      userId,
      orderItemId: line.id,
      locale: 'vi',
      values: values(),
    });
    const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
    expect(row).toMatchObject({ status: 'pending', userId, rating: 5, locale: 'vi' });

    const again = await rejection(
      submitMemberReview(db, { userId, orderItemId: line.id, locale: 'en', values: values() }),
    );
    expect(again.code).toBe('conflict');
    expect(again.fieldErrors[0]?.code).toBe('alreadyReviewed');

    const after = await listReviewableItems(db, { userId, locale: 'vi' });
    expect(after.map((item) => item.orderItemId)).toEqual([second]);
    const mine = await listMemberReviews(db, { userId, locale: 'vi' });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('pending');
  });

  it('refuses lines of someone else, and orders not delivered', async () => {
    const owner = await insertCustomer(db, 'owner-line@example.com');
    const intruder = await insertCustomer(db, 'intruder@example.com');
    const delivered = await insertOrder(db, { userId: owner, status: 'delivered' });
    const shipped = await insertOrder(db, { userId: owner, status: 'shipped' });

    const foreign = await rejection(
      submitMemberReview(db, {
        userId: intruder,
        orderItemId: (await lineOf(delivered.id)).id,
        locale: 'vi',
        values: values(),
      }),
    );
    expect(foreign.code).toBe('notFound');

    const early = await rejection(
      submitMemberReview(db, {
        userId: owner,
        orderItemId: (await lineOf(shipped.id)).id,
        locale: 'vi',
        values: values(),
      }),
    );
    expect(early.fieldErrors[0]?.code).toBe('notReviewable');
  });

  it('keeps one review per line when two submissions race', async () => {
    const userId = await insertCustomer(db, 'racer@example.com');
    const order = await insertOrder(db, { userId, status: 'completed' });
    const line = await lineOf(order.id);
    const results = await Promise.allSettled([
      submitMemberReview(db, { userId, orderItemId: line.id, locale: 'vi', values: values() }),
      submitMemberReview(db, { userId, orderItemId: line.id, locale: 'vi', values: values() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.select().from(reviews).where(eq(reviews.orderItemId, line.id));
    expect(rows).toHaveLength(1);
  });
});

describe('review invitations', () => {
  it('schedules review.invite a few days after the first delivery only', async () => {
    const order = await insertOrder(db, { status: 'delivered' });
    const before = (await jobs('review.invite')).length;
    await handlers['order.status-changed']({ orderId: order.id, from: 'shipped', to: 'delivered' });
    // A rejected return moves back to delivered: no second invitation.
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'return_requested',
      to: 'delivered',
    });
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'processing',
      to: 'shipped',
    });
    const queued = (await jobs('review.invite')).slice(before);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({ orderId: order.id });
    const delay = new Date(queued[0]!.start_after).getTime() - Date.now();
    expect(delay).toBeGreaterThan(2.9 * 24 * 3600_000);
  });

  it('e-mails guests one hashed, 30-day link per line, once, in the order locale', async () => {
    const order = await insertOrder(db, {
      status: 'delivered',
      locale: 'en',
      email: 'guest-invite@example.com',
    });
    await addLine(order.id);

    await handlers['review.invite']({ orderId: order.id });
    await handlers['review.invite']({ orderId: order.id }); // retried / duplicated job

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('guest-invite@example.com');
    expect(sent[0]!.subject).toContain(order.code);
    expect(sent[0]!.html).toContain('lang="en"');
    const tokens = tokensIn(sent[0]!.html);
    expect(tokens).toHaveLength(2);
    expect(sent[0]!.html).toContain(`${APP_URL}/en/review/${tokens[0]}`);

    const rows = await db
      .select()
      .from(reviewInvitations)
      .innerJoin(orderItems, eq(orderItems.id, reviewInvitations.orderItemId))
      .where(eq(orderItems.orderId, order.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.review_invitations.tokenHash).sort()).toEqual(
      tokens.map(hashReviewToken).sort(),
    );
    for (const row of rows) {
      expect(row.review_invitations.tokenHash).not.toContain(tokens[0]!);
      const days = (row.review_invitations.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);
    }
  });

  it('issues fresh tokens when the send failed and the job retries', async () => {
    const order = await insertOrder(db, { status: 'delivered', email: 'retry@example.com' });
    failNextEmail = 1;
    await expect(handlers['review.invite']({ orderId: order.id })).rejects.toThrow('SMTP');
    const none = await db
      .select()
      .from(reviewInvitations)
      .where(eq(reviewInvitations.email, 'retry@example.com'));
    expect(none).toHaveLength(0);

    await handlers['review.invite']({ orderId: order.id });
    expect(sent).toHaveLength(1);
    const [token] = tokensIn(sent[0]!.html);
    const view = await getInvitationByToken(db, { token: token!, locale: 'vi' });
    expect(view?.state).toBe('valid');
  });

  it('sends members a link to their account reviews, without tokens', async () => {
    const userId = await insertCustomer(db, 'member-invite@example.com');
    const order = await insertOrder(db, {
      userId,
      status: 'delivered',
      email: 'member-invite@example.com',
    });
    await handlers['review.invite']({ orderId: order.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain(`${APP_URL}/tai-khoan/danh-gia`);
    expect(tokensIn(sent[0]!.html)).toEqual([]);
    const rows = await db
      .select()
      .from(reviewInvitations)
      .where(eq(reviewInvitations.email, 'member-invite@example.com'));
    expect(rows).toHaveLength(0);
  });

  it('skips returned orders and orders without an e-mail', async () => {
    const returned = await insertOrder(db, { status: 'returned' });
    expect(await sendReviewInvitations(deps(), returned.id)).toBe('not_reviewable');
    const phoneOnly = await insertOrder(db, { status: 'delivered', email: '' });
    expect(await sendReviewInvitations(deps(), phoneOnly.id)).toBe('no_email');
    expect(sent).toHaveLength(0);
  });
});

describe('guest reviews through the link', () => {
  async function invitedGuestOrder(email: string) {
    const order = await insertOrder(db, { status: 'delivered', email });
    await sendReviewInvitations(deps(), order.id);
    const token = tokensIn(sent.at(-1)!.html)[0]!;
    return { order, token };
  }

  it('accepts one review per link and marks the link used', async () => {
    const { order, token } = await invitedGuestOrder('guest-review@example.com');
    const view = await getInvitationByToken(db, { token, locale: 'vi' });
    expect(view).toMatchObject({ state: 'valid', orderCode: order.code, suggestedName: 'Hương' });

    const { id } = await submitGuestReview(db, { token, locale: 'vi', values: values() });
    const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
    expect(row).toMatchObject({ status: 'pending', userId: null });
    const [invitation] = await db
      .select()
      .from(reviewInvitations)
      .where(eq(reviewInvitations.tokenHash, hashReviewToken(token)));
    expect(invitation!.usedAt).not.toBeNull();

    const again = await rejection(submitGuestReview(db, { token, locale: 'vi', values: values() }));
    expect(again.fieldErrors[0]?.code).toBe('alreadyReviewed');
    expect((await getInvitationByToken(db, { token, locale: 'vi' }))?.state).toBe('used');
  });

  it('refuses expired, unknown and returned-order links', async () => {
    const { token } = await invitedGuestOrder('guest-expired@example.com');
    await db
      .update(reviewInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(reviewInvitations.tokenHash, hashReviewToken(token)));
    expect((await getInvitationByToken(db, { token, locale: 'vi' }))?.state).toBe('expired');
    const expired = await rejection(
      submitGuestReview(db, { token, locale: 'vi', values: values() }),
    );
    expect(expired.fieldErrors[0]?.code).toBe('linkExpired');

    const unknown = await rejection(
      submitGuestReview(db, { token: 'A'.repeat(43), locale: 'vi', values: values() }),
    );
    expect(unknown.code).toBe('notFound');
    expect(await getInvitationByToken(db, { token: 'A'.repeat(43), locale: 'vi' })).toBeNull();

    const returned = await invitedGuestOrder('guest-returned@example.com');
    await db.update(orders).set({ status: 'returned' }).where(eq(orders.id, returned.order.id));
    const refused = await rejection(
      submitGuestReview(db, { token: returned.token, locale: 'vi', values: values() }),
    );
    expect(refused.fieldErrors[0]?.code).toBe('notReviewable');
  });
});

describe('moderation and aggregates', () => {
  it('publishes approved reviews, keeps products.rating_* in step and revalidates the PDP', async () => {
    const productOrder = await insertOrder(db, { status: 'delivered' });
    const productId = (await lineOf(productOrder.id)).productId;
    await db
      .update(products)
      .set({ ratingAvg: 0, ratingCount: 0 })
      .where(eq(products.id, productId));
    // Reviews already written for this product by earlier tests stay pending here.
    const ids: string[] = [];
    for (const [i, rating, locale] of [
      [0, 5, 'vi'],
      [1, 4, 'en'],
      [2, 2, 'vi'],
    ] as const) {
      const userId = await insertCustomer(db, `moderation-${i}@example.com`);
      const order = await insertOrder(db, { userId, status: 'delivered' });
      const line = await lineOf(order.id);
      expect(line.productId).toBe(productId);
      const { id } = await submitMemberReview(db, {
        userId,
        orderItemId: line.id,
        locale,
        values: values({ rating, longevity: rating === 2 ? null : 4, sillage: null }),
      });
      ids.push(id);
    }

    expect((await getReviewSummary(db, productId)).count).toBe(0);
    const revalidateBefore = (await jobs('cache.revalidate')).length;

    for (const id of ids) {
      const result = await moderateReview(ctx('editor'), { id, decision: 'approved' });
      expect(result.data.status).toBe('approved');
      expect(result.tags).toEqual(expect.arrayContaining([reviewTags.product(productId)]));
    }
    const summary = await getReviewSummary(db, productId);
    expect(summary).toMatchObject({ count: 3, average: 3.7, longevity: 4, sillage: null });
    expect(summary.distribution).toMatchObject({ 5: 1, 4: 1, 2: 1 });
    const [product] = await db
      .select({ avg: products.ratingAvg, count: products.ratingCount })
      .from(products)
      .where(eq(products.id, productId));
    expect(product).toEqual({ avg: 3.7, count: 3 });
    const revalidations = (await jobs('cache.revalidate')).slice(revalidateBefore);
    expect(revalidations).toHaveLength(3);
    expect(revalidations[0]!.data.tags).toEqual([
      `product:${productId}`,
      `reviews:product:${productId}`,
    ]);

    // English visitors see the English review first.
    const en = await listPublishedReviews(db, { productId, locale: 'en' });
    expect(en.total).toBe(3);
    expect(en.rows[0]!.locale).toBe('en');
    expect(en.rows[0]!.variantLabel).toBe('100 ml');
    const vi = await listPublishedReviews(db, { productId, locale: 'vi', pageSize: 2 });
    expect(vi.rows.map((r) => r.locale)).toEqual(['vi', 'vi']);
    expect(vi.pageCount).toBe(2);

    // Rejecting recomputes; re-rejecting is a no-op.
    await moderateReview(ctx('owner'), { id: ids[2]!, decision: 'rejected' });
    const noop = await moderateReview(ctx('owner'), { id: ids[2]!, decision: 'rejected' });
    expect(noop.tags).toEqual([]);
    expect(await getReviewSummary(db, productId)).toMatchObject({ count: 2, average: 4.5 });
    const [after] = await db
      .select({ avg: products.ratingAvg, count: products.ratingCount })
      .from(products)
      .where(eq(products.id, productId));
    expect(after).toEqual({ avg: 4.5, count: 2 });

    const audit = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'review'), eq(auditLogs.entityId, ids[2]!)));
    expect(audit.map((a) => a.action)).toEqual(['review.approve', 'review.reject']);
  });

  it('replies publicly, and refuses staff without reviews.moderate', async () => {
    const userId = await insertCustomer(db, 'reply@example.com');
    const order = await insertOrder(db, { userId, status: 'delivered' });
    const { id } = await submitMemberReview(db, {
      userId,
      orderItemId: (await lineOf(order.id)).id,
      locale: 'vi',
      values: values(),
    });
    const pendingReply = await replyToReview(ctx('editor'), { id, reply: 'Cảm ơn bạn!' });
    // Not published yet: nothing to revalidate.
    expect(pendingReply.tags).toEqual([]);
    await moderateReview(ctx('editor'), { id, decision: 'approved' });
    const cleared = await replyToReview(ctx('editor'), { id, reply: null });
    expect(cleared.data.adminReply).toBeNull();
    expect(cleared.tags.length).toBeGreaterThan(0);

    expect((await rejection(moderateReview(ctx('staff'), { id, decision: 'rejected' }))).code).toBe(
      'forbidden',
    );
    expect((await rejection(replyToReview(ctx('staff'), { id, reply: 'x' }))).code).toBe(
      'forbidden',
    );
  });

  it('lists the moderation queue by status with search and counts', async () => {
    const counts = await countReviewsByStatus(db);
    expect(counts.pending).toBeGreaterThan(0);
    const pending = await listReviewsForModeration(db, {
      status: 'pending',
      page: 1,
      pageSize: 50,
    });
    expect(pending.total).toBe(counts.pending);
    expect(pending.rows.every((r) => r.status === 'pending')).toBe(true);
    // Oldest first in the pending queue.
    const times = pending.rows.map((r) => r.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const search = await listReviewsForModeration(db, { q: 'huong', page: 1, pageSize: 50 });
    expect(search.total).toBeGreaterThan(0);
  });
});

describe('wishlist', () => {
  it('adds, removes idempotently and caps the list', async () => {
    const userId = await insertCustomer(db, 'wishlist@example.com');
    const [product] = await db.select({ id: products.id }).from(products).limit(1);
    expect(await setWishlisted(db, { userId, productId: product!.id, wishlisted: true })).toEqual({
      wishlisted: true,
    });
    await setWishlisted(db, { userId, productId: product!.id, wishlisted: true });
    expect(await listWishlistProductIds(db, userId)).toEqual([product!.id]);
    await setWishlisted(db, { userId, productId: product!.id, wishlisted: false });
    await setWishlisted(db, { userId, productId: product!.id, wishlisted: false });
    expect(await listWishlistProductIds(db, userId)).toEqual([]);

    const missing = await rejection(
      setWishlisted(db, { userId, productId: newId(), wishlisted: true }),
    );
    expect(missing.code).toBe('notFound');

    // At the cap one more is refused. The demo seed has only a few products, so the FK is
    // dropped in this throwaway database to fill the list with placeholder ids (last test).
    const other = await insertCustomer(db, 'wishlist-full@example.com');
    await db.execute(
      sql`alter table wishlists drop constraint if exists wishlists_product_id_products_id_fk`,
    );
    for (let i = 0; i < MAX_WISHLIST_ITEMS; i += 1) {
      await db.insert(wishlists).values({ userId: other, productId: newId() });
    }
    const full = await rejection(
      setWishlisted(db, { userId: other, productId: product!.id, wishlisted: true }),
    );
    expect(full.fieldErrors[0]?.code).toBe('wishlistFull');
  });
});
