import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';
import { consents, newsletterSubscribers, users } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { maskEmail } from '@/server/lib/mask';
import { enqueue } from '@/server/jobs/queue';

import { CONSENT_POLICY_VERSION } from './consents';
import {
  signNewsletterSignup,
  signNewsletterUnsubscribe,
  verifyNewsletterSignup,
  verifyNewsletterUnsubscribe,
  type NewsletterSignup,
} from './newsletter-rules';
import type { NewsletterSignupValues, NewsletterUnsubscribeInput } from './newsletter-schemas';

/*
 * Newsletter (§2 Marketing; PDPL 91/2025, Decree 356/2025). Double opt-in:
 *  1. the public form e-mails a signed confirmation link: same answer for every address (no
 *     enumeration) and nothing stored before the link is confirmed;
 *  2. the confirm page files the subscription only after an explicit "Confirm" (mail scanners
 *     follow links): an append-only `consents` row (purpose `marketing_email`) and the
 *     `newsletter_subscribers` row pointing to it, plus a welcome e-mail with the
 *     unsubscribe link;
 *  3. unsubscribing (signed link page, or RFC 8058 one-click POST from the mail client)
 *     appends `granted = false` and marks the row `unsubscribed`.
 *
 * Accounts: `users.marketing_opt_in` (profile, privacy centre) and the subscriber row of the
 * account e-mail are kept in sync both ways by this module, which owns both tables.
 */

export type RequestContext = { ip: string | null; userAgent: string | null };

const UA_LIMIT = 512;

function confirmUrl(appUrl: string, locale: 'vi' | 'en', token: string): string {
  const url = new URL(absoluteUrl(appUrl, localizedPath(locale, '/newsletter/confirm')));
  url.searchParams.set('token', token);
  return url.toString();
}

/** Signed unsubscribe page of a subscriber (for every marketing e-mail). */
export function newsletterUnsubscribeUrl(
  appUrl: string,
  secret: string,
  subscriberId: string,
  locale: 'vi' | 'en',
): string {
  const url = new URL(absoluteUrl(appUrl, localizedPath(locale, '/newsletter/unsubscribe')));
  url.searchParams.set('s', subscriberId);
  url.searchParams.set('t', signNewsletterUnsubscribe(secret, subscriberId));
  return url.toString();
}

/** RFC 8058 one-click endpoint for the `List-Unsubscribe` header (POST, no locale). */
export function newsletterOneClickUrl(appUrl: string, secret: string, subscriberId: string) {
  const url = new URL(absoluteUrl(appUrl, '/api/newsletter/unsubscribe'));
  url.searchParams.set('s', subscriberId);
  url.searchParams.set('t', signNewsletterUnsubscribe(secret, subscriberId));
  return url.toString();
}

// ---------- 1. Sign-up ----------

/** Queues the confirmation e-mail (outbox). The caller answers the same in every case. */
export async function startNewsletterSignup(
  db: Database,
  boss: PgBoss,
  input: { values: NewsletterSignupValues; secret: string; appUrl: string; now?: Date },
): Promise<void> {
  const { values } = input;
  const token = signNewsletterSignup(
    input.secret,
    { email: values.email, locale: values.locale, source: values.source },
    input.now,
  );
  await db.transaction(async (tx) => {
    await enqueue(boss, tx, 'newsletter.confirm-request', {
      to: values.email,
      locale: values.locale,
      url: confirmUrl(input.appUrl, values.locale, token),
    });
  });
}

/** For the confirm page: the signed sign-up, or null when invalid or expired. */
export function readNewsletterSignupToken(
  secret: string,
  token: string | null | undefined,
  now?: Date,
): NewsletterSignup | null {
  return verifyNewsletterSignup(secret, token, now);
}

// ---------- 2. Confirmation ----------

async function accountIdForEmail(tx: Tx, email: string): Promise<string | null> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.deletedAt} is null`))
    .limit(1);
  return user?.id ?? null;
}

/** Inserts or re-activates the subscriber row of `email` (caller holds the transaction). */
async function upsertSubscribed(
  tx: Tx,
  input: { email: string; locale: 'vi' | 'en'; consentId: string | null; source: string },
): Promise<{ id: string; wasSubscribed: boolean }> {
  const [existing] = await tx
    .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, input.email))
    .for('update');
  if (existing) {
    if (existing.status !== 'subscribed') {
      await tx
        .update(newsletterSubscribers)
        .set({
          status: 'subscribed',
          locale: input.locale,
          consentId: input.consentId,
          source: input.source,
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscribers.id, existing.id));
    }
    return { id: existing.id, wasSubscribed: existing.status === 'subscribed' };
  }
  const id = newId();
  const [inserted] = await tx
    .insert(newsletterSubscribers)
    .values({
      id,
      email: input.email,
      locale: input.locale,
      status: 'subscribed',
      consentId: input.consentId,
      source: input.source,
    })
    // A concurrent confirmation of the same address inserted first: it is subscribed.
    .onConflictDoNothing({ target: newsletterSubscribers.email })
    .returning({ id: newsletterSubscribers.id });
  if (inserted) return { id: inserted.id, wasSubscribed: false };
  const [winner] = await tx
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, input.email));
  return { id: winner!.id, wasSubscribed: true };
}

export type NewsletterConfirmResult = { subscriberId: string; alreadySubscribed: boolean };

/**
 * The visitor confirmed from the e-mailed link: records the consent, subscribes the address,
 * turns on the account's marketing opt-in and queues the welcome e-mail. Idempotent: an
 * address that is already subscribed gets no second consent row or welcome e-mail.
 * Returns null for an invalid or expired token.
 */
export async function confirmNewsletterSubscription(
  db: Database,
  boss: PgBoss,
  input: { token: string; secret: string; context: RequestContext; now?: Date },
): Promise<NewsletterConfirmResult | null> {
  const signup = verifyNewsletterSignup(input.secret, input.token, input.now);
  if (!signup) return null;
  return db.transaction(async (tx) => {
    // Serialise confirmations of one address (double click, two tabs).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`newsletter:${signup.email}`}))`);
    const [current] = await tx
      .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, signup.email));
    if (current?.status === 'subscribed') {
      return { subscriberId: current.id, alreadySubscribed: true };
    }
    const userId = await accountIdForEmail(tx, signup.email);
    const consentId = newId();
    await tx.insert(consents).values({
      id: consentId,
      userId,
      email: signup.email,
      purpose: 'marketing_email',
      granted: true,
      policyVersion: CONSENT_POLICY_VERSION,
      locale: signup.locale,
      source: `newsletter_${signup.source}`,
      ip: input.context.ip,
      userAgent: input.context.userAgent?.slice(0, UA_LIMIT) ?? null,
    });
    const subscriber = await upsertSubscribed(tx, {
      email: signup.email,
      locale: signup.locale,
      consentId,
      source: signup.source,
    });
    if (userId) {
      await tx.update(users).set({ marketingOptIn: true }).where(eq(users.id, userId));
    }
    await enqueue(boss, tx, 'newsletter.welcome', { subscriberId: subscriber.id });
    return { subscriberId: subscriber.id, alreadySubscribed: false };
  });
}

// ---------- 3. Unsubscribe ----------

export type UnsubscribeView = { maskedEmail: string; subscribed: boolean };

/** For the unsubscribe page: who the signed link is for (masked), or null if invalid. */
export async function getNewsletterUnsubscribe(
  db: Pick<Database, 'select'>,
  input: { secret: string; s: string | null | undefined; t: string | null | undefined },
): Promise<UnsubscribeView | null> {
  if (!verifyNewsletterUnsubscribe(input.secret, input.s, input.t)) return null;
  const [row] = await db
    .select({ email: newsletterSubscribers.email, status: newsletterSubscribers.status })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, input.s!))
    .limit(1);
  // A valid link whose row is gone (anonymised account): nothing left to unsubscribe.
  if (!row) return { maskedEmail: '', subscribed: false };
  return { maskedEmail: maskEmail(row.email), subscribed: row.status === 'subscribed' };
}

/**
 * Unsubscribes the signed subscriber: `consents` gets `granted = false`, the row becomes
 * `unsubscribed` and the account's marketing opt-in is turned off. Idempotent; returns false
 * only for an invalid signature.
 */
export async function unsubscribeNewsletter(
  db: Database,
  input: NewsletterUnsubscribeInput & {
    secret: string;
    context: RequestContext;
    /** `newsletter_unsubscribe` (page) or `newsletter_one_click` (mail client header). */
    source: string;
  },
): Promise<boolean> {
  if (!verifyNewsletterUnsubscribe(input.secret, input.s, input.t)) return false;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        locale: newsletterSubscribers.locale,
        status: newsletterSubscribers.status,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.id, input.s))
      .for('update');
    if (!row || row.status === 'unsubscribed') return;
    const userId = await accountIdForEmail(tx, row.email);
    await tx.insert(consents).values({
      id: newId(),
      userId,
      email: row.email,
      purpose: 'marketing_email',
      granted: false,
      policyVersion: CONSENT_POLICY_VERSION,
      locale: row.locale,
      source: input.source,
      ip: input.context.ip,
      userAgent: input.context.userAgent?.slice(0, UA_LIMIT) ?? null,
    });
    await tx
      .update(newsletterSubscribers)
      .set({ status: 'unsubscribed', updatedAt: new Date() })
      .where(eq(newsletterSubscribers.id, row.id));
    if (userId) {
      await tx.update(users).set({ marketingOptIn: false }).where(eq(users.id, userId));
    }
  });
  return true;
}

// ---------- Accounts (profile, privacy centre) ----------

/**
 * Mirrors an account's marketing e-mail switch onto the newsletter row of its (verified)
 * e-mail: on → subscribed with the consent row just written (no double opt-in needed, the
 * account proved the address); off → unsubscribed. Runs in the caller's transaction.
 */
export async function syncAccountNewsletter(
  tx: Tx,
  input: {
    email: string;
    locale: 'vi' | 'en';
    granted: boolean;
    consentId: string | null;
    source: string;
  },
): Promise<void> {
  if (input.granted) {
    await upsertSubscribed(tx, {
      email: input.email,
      locale: input.locale,
      consentId: input.consentId,
      source: input.source,
    });
    return;
  }
  await tx
    .update(newsletterSubscribers)
    .set({ status: 'unsubscribed', updatedAt: new Date() })
    .where(
      and(
        eq(newsletterSubscribers.email, input.email),
        eq(newsletterSubscribers.status, 'subscribed'),
      ),
    );
}

// ---------- Worker ----------

/** Welcome e-mail data: only while the row is still subscribed. */
export async function getNewsletterWelcome(
  db: Pick<Database, 'select'>,
  subscriberId: string,
): Promise<{ email: string; locale: 'vi' | 'en' } | null> {
  const [row] = await db
    .select({
      email: newsletterSubscribers.email,
      locale: newsletterSubscribers.locale,
      status: newsletterSubscribers.status,
    })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, subscriberId))
    .limit(1);
  if (!row || row.status !== 'subscribed') return null;
  return { email: row.email, locale: row.locale };
}
