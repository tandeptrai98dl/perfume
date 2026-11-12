import { randomInt } from 'node:crypto';

import { signNewsletterUnsubscribe } from '../../../src/server/modules/customer/newsletter-rules';
import { withDb } from './privacy';

/** DB helpers for the newsletter spec (queued e-mails, subscriber rows, consents). */

const DEV_AUTH_SECRET = 'dev-only-insecure-better-auth-secret-change-me';

export function newsletterEmail(tag: string) {
  return `e2e-newsletter-${tag}-${Date.now()}-${randomInt(0, 1_000_000)}@perfume.test`;
}

/** A client IP of its own (sign-up limit: 5 per 10 minutes per IP). */
export function newsletterIp() {
  return `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

/** Confirmation link of the queued `newsletter.confirm-request` e-mail to `to`. */
export async function confirmationLink(to: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await withDb(async (db) => {
      if (!(await hasQueue(db))) return undefined;
      const result = await db.query<{ url: string }>(
        `select data->>'url' as url from pgboss.job
         where name = 'newsletter.confirm-request' and data->>'to' = $1
         order by created_on desc limit 1`,
        [to],
      );
      return result.rows[0]?.url;
    });
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No newsletter confirmation e-mail queued for ${to}`);
}

/** pg-boss creates its schema on the server's first enqueue. */
async function hasQueue(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }) {
  const result = await db.query("select to_regclass('pgboss.job') is not null as ok");
  return (result.rows[0] as { ok: boolean }).ok;
}

export async function queuedConfirmations(to: string): Promise<number> {
  return withDb(async (db) => {
    if (!(await hasQueue(db))) return 0;
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from pgboss.job
       where name = 'newsletter.confirm-request' and data->>'to' = $1`,
      [to],
    );
    return result.rows[0]!.n;
  });
}

export async function subscriberRow(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      status: string;
      locale: string;
      source: string;
      consent_id: string | null;
    }>(
      'select id, status, locale, source, consent_id from newsletter_subscribers where email = $1',
      [email],
    );
    return result.rows[0] ?? null;
  });
}

export async function newsletterConsents(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{ id: string; granted: boolean; source: string }>(
      `select id, granted, source from consents
       where email = $1 and purpose = 'marketing_email' order by created_at, id`,
      [email],
    );
    return result.rows;
  });
}

/** Signed unsubscribe page, as in the welcome e-mail (same secret as the web server). */
export function unsubscribePath(locale: 'vi' | 'en', subscriberId: string) {
  const secret = process.env.BETTER_AUTH_SECRET || DEV_AUTH_SECRET;
  const path = locale === 'vi' ? '/ban-tin/huy-dang-ky' : '/en/newsletter/unsubscribe';
  return `${path}?s=${subscriberId}&t=${signNewsletterUnsubscribe(secret, subscriberId)}`;
}

export function oneClickPath(subscriberId: string) {
  const secret = process.env.BETTER_AUTH_SECRET || DEV_AUTH_SECRET;
  return `/api/newsletter/unsubscribe?s=${subscriberId}&t=${signNewsletterUnsubscribe(secret, subscriberId)}`;
}

export async function cleanupNewsletter(email: string) {
  await withDb(async (db) => {
    if (await hasQueue(db)) {
      await db.query(
        `delete from pgboss.job where name like 'newsletter.%'
         and (data->>'to' = $1 or data->>'subscriberId' in
           (select id::text from newsletter_subscribers where email = $1))`,
        [email],
      );
    }
    await db.query('delete from newsletter_subscribers where email = $1', [email]);
    await db.query('delete from consents where email = $1', [email]);
  });
}
