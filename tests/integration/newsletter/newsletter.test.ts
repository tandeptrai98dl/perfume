import { asc, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { render, toPlainText } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { consents, newsletterSubscribers, users } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createEmailSender, type EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import {
  confirmNewsletterSubscription,
  getConsentState,
  getNewsletterUnsubscribe,
  signNewsletterSignup,
  signNewsletterUnsubscribe,
  startNewsletterSignup,
  unsubscribeNewsletter,
  updateAccountConsents,
  updateProfile,
} from '@/server/modules/customer';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertCustomer } from '../helpers/orders';

/*
 * Newsletter double opt-in (§2 Marketing): sign-up e-mails a signed link and stores nothing;
 * confirmation appends a `marketing_email` consent and subscribes; unsubscribe appends the
 * withdrawal; the account switch (profile, privacy centre) and the subscriber row stay in sync.
 */

const SECRET = 'newsletter-link-secret-newsletter-link-secret';
const APP_URL = 'https://shop.example';
const CONTEXT = { ip: '203.113.45.10', userAgent: 'vitest' };

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let handlers: JobHandlers;
type Sent = { to: string; subject: string; text: string; headers?: Record<string, string> };
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
        text: toPlainText(html),
        headers: message.headers,
      });
      return real.send(message);
    },
    close: () => real.close(),
  };
}

async function jobs(name: string): Promise<Record<string, unknown>[]> {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on, id`,
  );
  return result.rows.map((row) => row.data);
}

async function drain(name: 'newsletter.confirm-request' | 'newsletter.welcome') {
  for (const data of await jobs(name)) {
    await (handlers[name] as (payload: unknown) => Promise<void>)(data);
  }
  await db.execute(sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name}`);
}

async function subscriber(email: string) {
  const [row] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email));
  return row ?? null;
}

async function marketingConsents(email: string) {
  return db
    .select({
      id: consents.id,
      granted: consents.granted,
      source: consents.source,
      userId: consents.userId,
    })
    .from(consents)
    .where(eq(consents.email, email))
    .orderBy(asc(consents.createdAt), asc(consents.id));
}

async function signUpAndConfirm(email: string, source: 'footer' | 'home' = 'footer') {
  const token = signNewsletterSignup(SECRET, { email, locale: 'vi', source });
  return confirmNewsletterSubscription(db, boss, { token, secret: SECRET, context: CONTEXT });
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
});

beforeEach(() => {
  sent = [];
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('double opt-in', () => {
  it('sign-up e-mails a signed confirmation link and stores nothing', async () => {
    await startNewsletterSignup(db, boss, {
      values: { email: 'lan@example.com', consent: true, locale: 'en', source: 'home' },
      secret: SECRET,
      appUrl: APP_URL,
    });
    expect(await subscriber('lan@example.com')).toBeNull();
    expect(await marketingConsents('lan@example.com')).toEqual([]);

    const [job] = await jobs('newsletter.confirm-request');
    expect(job).toMatchObject({ to: 'lan@example.com', locale: 'en' });
    const url = new URL(String(job!.url));
    expect(url.origin + url.pathname).toBe(`${APP_URL}/en/newsletter/confirm`);
    expect(url.searchParams.get('token')).toBeTruthy();

    await drain('newsletter.confirm-request');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'lan@example.com',
      subject: 'Confirm your newsletter subscription',
    });
    expect(sent[0]!.text).toContain(String(job!.url));
  });

  it('confirmation records the consent, subscribes and sends one welcome e-mail', async () => {
    const result = await signUpAndConfirm('binh@example.com', 'home');
    expect(result).toMatchObject({ alreadySubscribed: false });

    const row = await subscriber('binh@example.com');
    const log = await marketingConsents('binh@example.com');
    expect(log).toEqual([
      { id: row!.consentId, granted: true, source: 'newsletter_home', userId: null },
    ]);
    expect(row).toMatchObject({ status: 'subscribed', locale: 'vi', source: 'home' });

    // Confirming again (double click, second tab) changes nothing.
    expect(await signUpAndConfirm('binh@example.com')).toMatchObject({
      subscriberId: row!.id,
      alreadySubscribed: true,
    });
    expect(await marketingConsents('binh@example.com')).toHaveLength(1);
    expect(await jobs('newsletter.welcome')).toEqual([{ subscriberId: row!.id }]);

    await drain('newsletter.welcome');
    expect(sent).toHaveLength(1);
    const welcome = sent[0]!;
    expect(welcome.subject).toBe('Chào mừng bạn đến với bản tin Perfume Store');
    const unsubscribePage = `${APP_URL}/ban-tin/huy-dang-ky?s=${row!.id}&t=${signNewsletterUnsubscribe(SECRET, row!.id)}`;
    expect(welcome.text).toContain(unsubscribePage);
    expect(welcome.headers).toEqual({
      'List-Unsubscribe': `<${APP_URL}/api/newsletter/unsubscribe?s=${row!.id}&t=${signNewsletterUnsubscribe(SECRET, row!.id)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('refuses invalid or expired tokens', async () => {
    const old = signNewsletterSignup(
      SECRET,
      { email: 'late@example.com', locale: 'vi', source: 'footer' },
      new Date(Date.now() - 73 * 3600_000),
    );
    expect(
      await confirmNewsletterSubscription(db, boss, {
        token: old,
        secret: SECRET,
        context: CONTEXT,
      }),
    ).toBeNull();
    expect(
      await confirmNewsletterSubscription(db, boss, {
        token: old,
        secret: 'another-secret-another-secret-another',
        context: CONTEXT,
      }),
    ).toBeNull();
    expect(await subscriber('late@example.com')).toBeNull();
  });
});

describe('unsubscribe', () => {
  it('appends the withdrawal, unsubscribes once and skips a pending welcome e-mail', async () => {
    await signUpAndConfirm('chi@example.com');
    const row = (await subscriber('chi@example.com'))!;
    const t = signNewsletterUnsubscribe(SECRET, row.id);

    expect(await getNewsletterUnsubscribe(db, { secret: SECRET, s: row.id, t })).toEqual({
      maskedEmail: 'c***@example.com',
      subscribed: true,
    });
    expect(
      await getNewsletterUnsubscribe(db, { secret: SECRET, s: row.id, t: 'x'.repeat(43) }),
    ).toBeNull();

    const input = {
      s: row.id,
      t,
      secret: SECRET,
      context: CONTEXT,
      source: 'newsletter_one_click',
    };
    expect(await unsubscribeNewsletter(db, input)).toBe(true);
    expect(await unsubscribeNewsletter(db, input)).toBe(true); // idempotent
    expect(await unsubscribeNewsletter(db, { ...input, t: 'x'.repeat(43) })).toBe(false);

    expect((await subscriber('chi@example.com'))!.status).toBe('unsubscribed');
    expect((await marketingConsents('chi@example.com')).map((c) => [c.granted, c.source])).toEqual([
      [true, 'newsletter_footer'],
      [false, 'newsletter_one_click'],
    ]);
    // The welcome job queued at confirmation finds the row unsubscribed: no e-mail.
    await drain('newsletter.welcome');
    expect(sent.filter((mail) => mail.to === 'chi@example.com')).toEqual([]);

    // Subscribing again re-activates the same row with a new consent.
    await signUpAndConfirm('chi@example.com');
    const again = (await subscriber('chi@example.com'))!;
    expect(again).toMatchObject({ id: row.id, status: 'subscribed' });
    expect(again.consentId).not.toBe(row.consentId);
    await drain('newsletter.welcome');
  });
});

describe('accounts', () => {
  it('confirming with an account e-mail turns on its marketing opt-in; unsubscribing turns it off', async () => {
    const userId = await insertCustomer(db, 'dung@example.com');
    await signUpAndConfirm('dung@example.com');
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.marketingOptIn).toBe(true);
    expect((await getConsentState(db, userId)).marketing_email.granted).toBe(true);
    expect((await marketingConsents('dung@example.com'))[0]!.userId).toBe(userId);

    const row = (await subscriber('dung@example.com'))!;
    await unsubscribeNewsletter(db, {
      s: row.id,
      t: signNewsletterUnsubscribe(SECRET, row.id),
      secret: SECRET,
      context: CONTEXT,
      source: 'newsletter_unsubscribe',
    });
    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after!.marketingOptIn).toBe(false);
    expect((await getConsentState(db, userId)).marketing_email.granted).toBe(false);
    await drain('newsletter.welcome');
  });

  it('the privacy centre switch subscribes and unsubscribes the account e-mail', async () => {
    const userId = await insertCustomer(db, 'em@example.com', 'en');
    const values = { locale: 'en' as const, marketingSms: false, analytics: false, ads: false };
    await updateAccountConsents(db, {
      userId,
      values: { ...values, marketingEmail: true },
      cookieChoice: { analytics: false, ads: false },
      context: CONTEXT,
    });
    const row = await subscriber('em@example.com');
    const [consent] = (await marketingConsents('em@example.com')).filter((c) => c.granted);
    expect(row).toMatchObject({ status: 'subscribed', locale: 'en', source: 'privacy_center' });
    expect(row!.consentId).toBe(consent!.id);

    await updateAccountConsents(db, {
      userId,
      values: { ...values, marketingEmail: false },
      cookieChoice: { analytics: false, ads: false },
      context: CONTEXT,
    });
    expect((await subscriber('em@example.com'))!.status).toBe('unsubscribed');
    // No welcome e-mail for an account switch: the person is already a customer.
    expect(await jobs('newsletter.welcome')).toEqual([]);
  });

  it('the profile opt-in follows the same rule', async () => {
    const userId = await insertCustomer(db, 'giang@example.com');
    const profile = {
      name: 'Giang',
      phone: null,
      birthday: null,
      locale: 'vi' as const,
      marketingOptIn: true,
    };
    await updateProfile(db, { userId, values: profile, context: CONTEXT });
    expect((await subscriber('giang@example.com'))!.status).toBe('subscribed');
    await updateProfile(db, {
      userId,
      values: { ...profile, marketingOptIn: false },
      context: CONTEXT,
    });
    expect((await subscriber('giang@example.com'))!.status).toBe('unsubscribed');
  });
});
