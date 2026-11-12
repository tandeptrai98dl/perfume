import { and, count, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';
import {
  auditLogs,
  consents,
  newsletterSubscribers,
  privacyRequests,
  users,
} from '@/server/db/schema';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { enqueue } from '@/server/jobs/queue';
import { containsPattern, pageOffset, type Paged } from '@/server/lib/sql-helpers';
import { deleteCartsForUser } from '@/server/modules/cart';
import { anonymizeOrdersForSubject, countOpenOrdersForSubject } from '@/server/modules/order';

import { CONSENT_POLICY_VERSION, type ConsentPurpose } from './consents';
import { syncAccountNewsletter } from './newsletter';
import { eraseCustomerData, type PrivacySubject } from './privacy-erasure';
import {
  canTransitionPrivacyRequest,
  exportLinkExpiry,
  isOverdue,
  OPEN_PRIVACY_STATUSES,
  privacyDueAt,
  signExportLink,
  signGuestRequest,
  verifyGuestRequest,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from './privacy-rules';
import {
  privacyRequestListSchema,
  type AccountConsentsInput,
  type AccountPrivacyRequestInput,
  type GuestPrivacyRequestInput,
  type PrivacyRequestListQuery,
} from './privacy-schemas';

/*
 * Data-subject requests (§10.6 privacy centre, §11.2 privacy requests; PDPL 91/2025, Decree
 * 356/2025). Members file requests from the privacy centre (identity = session); guests through
 * the public form, confirmed from a signed e-mail link. Every request gets `due_at` by type and a
 * confirmation e-mail (outbox). Exports are produced automatically; deletion (anonymisation),
 * correction and rejection are handled by the Owner in /admin/privacy-requests, audited.
 */

export type PrivacyRequestView = {
  id: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  email: string;
  userId: string | null;
  dueAt: Date;
  completedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  overdue: boolean;
};

const requestColumns = {
  id: privacyRequests.id,
  type: privacyRequests.type,
  status: privacyRequests.status,
  email: privacyRequests.email,
  userId: privacyRequests.userId,
  dueAt: privacyRequests.dueAt,
  completedAt: privacyRequests.completedAt,
  note: privacyRequests.note,
  createdAt: privacyRequests.createdAt,
  updatedAt: privacyRequests.updatedAt,
};

function toView(row: Omit<PrivacyRequestView, 'overdue'>, now = new Date()): PrivacyRequestView {
  return { ...row, overdue: isOverdue(row, now) };
}

/** Where the customer manages requests (link in e-mails). */
export function privacyCenterUrl(appUrl: string, locale: 'vi' | 'en'): string {
  return absoluteUrl(appUrl, localizedPath(locale, '/account/privacy'));
}

/** Signed download link of an export (valid PRIVACY_EXPORT_LINK_DAYS). */
export function exportDownloadUrl(
  appUrl: string,
  secret: string,
  requestId: string,
  expiresAt: Date,
): string {
  const url = new URL(absoluteUrl(appUrl, `/api/privacy/export/${requestId}`));
  const { e, t } = signExportLink(secret, requestId, expiresAt);
  url.searchParams.set('e', e);
  url.searchParams.set('t', t);
  return url.toString();
}

type Requester = { userId: string | null; email: string; locale: 'vi' | 'en' };

async function findOpenRequest(
  tx: Pick<Database, 'select'>,
  requester: Pick<Requester, 'userId' | 'email'>,
  type: PrivacyRequestType,
) {
  const owner = requester.userId
    ? or(eq(privacyRequests.userId, requester.userId), eq(privacyRequests.email, requester.email))
    : eq(privacyRequests.email, requester.email);
  const [row] = await tx
    .select(requestColumns)
    .from(privacyRequests)
    .where(
      and(
        owner,
        eq(privacyRequests.type, type),
        inArray(privacyRequests.status, [...OPEN_PRIVACY_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Inserts a request (or returns the open one of the same type: one open request per type and
 * person), enqueues the confirmation e-mail and the follow-up job in the same transaction.
 */
async function fileRequest(
  tx: Tx,
  boss: PgBoss,
  input: Requester & { type: PrivacyRequestType; details: string | null; source: string },
): Promise<{ request: PrivacyRequestView; created: boolean }> {
  const existing = await findOpenRequest(tx, input, input.type);
  if (existing) return { request: toView(existing), created: false };

  const now = new Date();
  const id = newId();
  // Withdrawal of marketing consent is carried out at once (no staff step needed).
  const immediate = input.type === 'withdraw_consent';
  if (immediate) await withdrawMarketing(tx, input, input.source);
  const [row] = await tx
    .insert(privacyRequests)
    .values({
      id,
      userId: input.userId,
      email: input.email,
      type: input.type,
      status: immediate ? 'completed' : 'received',
      dueAt: privacyDueAt(input.type, now),
      completedAt: immediate ? now : null,
      note: input.details,
    })
    .returning(requestColumns);
  await recordAudit(tx, {
    actorId: input.userId,
    action: 'privacy_request.created',
    entityType: 'privacy_request',
    entityId: id,
    diff: { type: input.type, source: input.source, status: row!.status, locale: input.locale },
  });
  if (input.type === 'export') {
    // The export e-mail (download link) is the answer; no separate "received" e-mail.
    await enqueue(boss, tx, 'privacy.export', { requestId: id });
  } else {
    await enqueue(boss, tx, 'privacy.notify', {
      requestId: id,
      kind: immediate ? 'completed' : 'received',
    });
  }
  return { request: toView(row!), created: true };
}

/** Appends `granted = false` for the marketing purposes and unsubscribes the newsletter. */
async function withdrawMarketing(tx: Tx, requester: Requester, source: string) {
  await tx.insert(consents).values(
    (['marketing_email', 'marketing_sms'] as const).map((purpose) => ({
      userId: requester.userId,
      email: requester.email,
      purpose,
      granted: false,
      policyVersion: CONSENT_POLICY_VERSION,
      locale: requester.locale,
      source,
    })),
  );
  if (requester.userId) {
    await tx.update(users).set({ marketingOptIn: false }).where(eq(users.id, requester.userId));
  }
  await tx
    .update(newsletterSubscribers)
    .set({ status: 'unsubscribed' })
    .where(eq(newsletterSubscribers.email, requester.email));
}

// ---------- Privacy centre (members) ----------

export async function requestAccountPrivacy(
  db: Database,
  boss: PgBoss,
  input: { userId: string; values: AccountPrivacyRequestInput },
): Promise<{ request: PrivacyRequestView; created: boolean }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!user || user.deletedAt) throw new DomainError('notFound');
    const { values } = input;
    return fileRequest(tx, boss, {
      userId: input.userId,
      email: user.email,
      locale: values.locale,
      type: values.type,
      details: 'details' in values ? (values.details ?? null) : null,
      source: 'privacy_center',
    });
  });
}

export async function listAccountPrivacyRequests(
  db: Pick<Database, 'select'>,
  userId: string,
): Promise<PrivacyRequestView[]> {
  const rows = await db
    .select(requestColumns)
    .from(privacyRequests)
    .where(eq(privacyRequests.userId, userId))
    .orderBy(desc(privacyRequests.createdAt))
    .limit(50);
  const now = new Date();
  return rows.map((row) => toView(row, now));
}

/** The member's own request (download in account); null when it belongs to someone else. */
export async function getAccountPrivacyRequest(
  db: Pick<Database, 'select'>,
  input: { userId: string; requestId: string },
): Promise<PrivacyRequestView | null> {
  const [row] = await db
    .select(requestColumns)
    .from(privacyRequests)
    .where(and(eq(privacyRequests.id, input.requestId), eq(privacyRequests.userId, input.userId)))
    .limit(1);
  return row ? toView(row) : null;
}

export type ConsentState = Record<
  'marketing_email' | 'marketing_sms' | 'analytics' | 'ads',
  { granted: boolean; at: Date | null }
>;

export type ConsentHistoryEntry = {
  id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: string;
  policyVersion: string;
  createdAt: Date;
};

/** Latest decision per optional purpose from the append-only log (default: not granted). */
export async function getConsentState(
  db: Pick<Database, 'select' | 'selectDistinctOn'>,
  userId: string,
): Promise<ConsentState> {
  const rows = await db
    .selectDistinctOn([consents.purpose], {
      purpose: consents.purpose,
      granted: consents.granted,
      createdAt: consents.createdAt,
    })
    .from(consents)
    .where(
      and(
        eq(consents.userId, userId),
        inArray(consents.purpose, ['marketing_email', 'marketing_sms', 'analytics', 'ads']),
      ),
    )
    .orderBy(consents.purpose, desc(consents.createdAt), desc(consents.id));
  const state: ConsentState = {
    marketing_email: { granted: false, at: null },
    marketing_sms: { granted: false, at: null },
    analytics: { granted: false, at: null },
    ads: { granted: false, at: null },
  };
  for (const row of rows) {
    const key = row.purpose as keyof ConsentState;
    state[key] = { granted: row.granted, at: row.createdAt };
  }
  // `users.marketing_opt_in` is the switch the rest of the app reads (profile, checkout).
  const [user] = await db
    .select({ marketingOptIn: users.marketingOptIn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user) state.marketing_email.granted = user.marketingOptIn;
  return state;
}

export async function listConsentHistory(
  db: Pick<Database, 'select'>,
  userId: string,
  limit = 50,
): Promise<ConsentHistoryEntry[]> {
  return db
    .select({
      id: consents.id,
      purpose: consents.purpose,
      granted: consents.granted,
      source: consents.source,
      policyVersion: consents.policyVersion,
      createdAt: consents.createdAt,
    })
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.createdAt), desc(consents.id))
    .limit(limit);
}

export type ConsentRequestContext = { ip: string | null; userAgent: string | null };

/**
 * Privacy centre switches: appends one row per changed purpose (never updates), keeps
 * `users.marketing_opt_in` in sync. `analytics` / `ads` are compared with the device's cookie
 * choice (`current`), since that is what the browser obeys.
 */
export async function updateAccountConsents(
  db: Database,
  input: {
    userId: string;
    values: AccountConsentsInput;
    cookieChoice: { analytics: boolean; ads: boolean } | null;
    context: ConsentRequestContext;
  },
): Promise<{ changed: ConsentPurpose[] }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email, marketingOptIn: users.marketingOptIn })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');
    if (!user) throw new DomainError('notFound');
    const current = await getConsentState(tx, input.userId);
    const { values } = input;
    const wanted: [ConsentPurpose, boolean, boolean][] = [
      ['marketing_email', values.marketingEmail, user.marketingOptIn],
      ['marketing_sms', values.marketingSms, current.marketing_sms.granted],
      ['analytics', values.analytics, input.cookieChoice?.analytics ?? current.analytics.granted],
      ['ads', values.ads, input.cookieChoice?.ads ?? current.ads.granted],
    ];
    const changed = wanted.filter(([, next, before]) => next !== before);
    // Analytics/ads are always logged when the device had no choice yet (first answer).
    const cookieFirstAnswer = !input.cookieChoice;
    const rows = wanted.filter(
      ([purpose, next, before]) =>
        next !== before || (cookieFirstAnswer && (purpose === 'analytics' || purpose === 'ads')),
    );
    // M3 wave 2: the marketing e-mail row's id becomes the newsletter row's consent.
    const marketingConsentId = newId();
    if (rows.length > 0) {
      await tx.insert(consents).values(
        rows.map(([purpose, granted]) => ({
          id: purpose === 'marketing_email' ? marketingConsentId : newId(),
          userId: input.userId,
          email: purpose.startsWith('marketing') ? user.email : null,
          purpose,
          granted,
          policyVersion: CONSENT_POLICY_VERSION,
          locale: values.locale,
          source: 'privacy_center',
          ip: input.context.ip,
          userAgent: input.context.userAgent?.slice(0, 512) ?? null,
        })),
      );
    }
    if (values.marketingEmail !== user.marketingOptIn) {
      await tx
        .update(users)
        .set({ marketingOptIn: values.marketingEmail })
        .where(eq(users.id, input.userId));
      await syncAccountNewsletter(tx, {
        email: user.email,
        locale: values.locale,
        granted: values.marketingEmail,
        consentId: marketingConsentId,
        source: 'privacy_center',
      });
    }
    return { changed: changed.map(([purpose]) => purpose) };
  });
}

/**
 * Cookie banner / preferences choice: one row per optional category (analytics, ads). Returns
 * the first row id, stored in the cookie as the consent receipt. Anonymous visitors are
 * recorded with a truncated IP only (the caller truncates).
 */
export async function recordCookieChoice(
  db: Pick<Database, 'insert'>,
  input: {
    analytics: boolean;
    ads: boolean;
    userId: string | null;
    locale: 'vi' | 'en';
    source: string;
    policyVersion: string;
    context: ConsentRequestContext;
  },
): Promise<string> {
  const receiptId = newId();
  await db.insert(consents).values(
    [
      { id: receiptId, purpose: 'analytics' as const, granted: input.analytics },
      { id: newId(), purpose: 'ads' as const, granted: input.ads },
    ].map((row) => ({
      ...row,
      userId: input.userId,
      policyVersion: input.policyVersion,
      locale: input.locale,
      source: input.source,
      ip: input.context.ip,
      userAgent: input.context.userAgent?.slice(0, 512) ?? null,
    })),
  );
  return receiptId;
}

// ---------- Guest requests (public form + e-mail verification) ----------

/**
 * Step 1: signs the request into the confirmation link and e-mails it. Nothing is stored until
 * the link is confirmed, and the answer is the same whether or not the e-mail is known.
 */
export async function startGuestPrivacyRequest(
  db: Database,
  boss: PgBoss,
  input: { values: GuestPrivacyRequestInput; secret: string; appUrl: string; now?: Date },
): Promise<void> {
  const { values } = input;
  const token = signGuestRequest(
    input.secret,
    {
      email: values.email,
      type: values.type,
      locale: values.locale,
      details: values.details ?? null,
    },
    input.now,
  );
  const url = new URL(
    absoluteUrl(input.appUrl, localizedPath(values.locale, '/privacy-request/confirm')),
  );
  url.searchParams.set('token', token);
  await db.transaction(async (tx) => {
    await enqueue(boss, tx, 'privacy.verify-request', {
      to: values.email,
      locale: values.locale,
      type: values.type,
      url: url.toString(),
    });
  });
}

/** Reads a confirmation token for the confirm page (null when invalid or expired). */
export function readGuestRequestToken(secret: string, token: string | null | undefined) {
  return verifyGuestRequest(secret, token);
}

/** Step 2: the guest confirmed from the e-mail link; the request is filed (idempotent). */
export async function confirmGuestPrivacyRequest(
  db: Database,
  boss: PgBoss,
  input: { token: string; secret: string; now?: Date },
): Promise<{ request: PrivacyRequestView; created: boolean }> {
  const verified = verifyGuestRequest(input.secret, input.token, input.now);
  if (!verified) throw new DomainError('invalid', [{ path: 'token', code: 'tokenInvalid' }]);
  return db.transaction(async (tx) => {
    // The person proved control of the e-mail: attach the account that uses it, if any.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, verified.email), sql`${users.deletedAt} is null`))
      .limit(1);
    return fileRequest(tx, boss, {
      userId: user?.id ?? null,
      email: verified.email,
      locale: verified.locale,
      type: verified.type,
      details: verified.details,
      source: 'guest_form',
    });
  });
}

// ---------- Worker: export ----------

/**
 * `privacy.export`: completes an export request. Returns the data the e-mail needs, or null
 * when the request is gone or was rejected (job acknowledged).
 */
export async function completeExportRequest(
  db: Database,
  requestId: string,
  now: Date = new Date(),
): Promise<{ email: string; locale: 'vi' | 'en'; expiresAt: Date } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: privacyRequests.status,
        type: privacyRequests.type,
        email: privacyRequests.email,
        userId: privacyRequests.userId,
      })
      .from(privacyRequests)
      .where(eq(privacyRequests.id, requestId))
      .for('update');
    if (!row || row.type !== 'export' || row.status === 'rejected') return null;
    if (row.status !== 'completed') {
      await tx
        .update(privacyRequests)
        .set({ status: 'completed', completedAt: now })
        .where(eq(privacyRequests.id, requestId));
    }
    const locale = await requesterLocale(tx, row.userId, requestId);
    return { email: row.email, locale, expiresAt: exportLinkExpiry(now) };
  });
}

/**
 * Language of the requester's e-mails: the account's language, else the language the request
 * was filed in (kept in the audit row of the creation).
 */
async function requesterLocale(
  db: Pick<Database, 'select'>,
  userId: string | null,
  requestId: string,
): Promise<'vi' | 'en'> {
  if (userId) {
    const [user] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user) return user.locale;
  }
  const [row] = await db
    .select({ locale: sql<string | null>`${auditLogs.diff}->>'locale'` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'privacy_request'),
        eq(auditLogs.entityId, requestId),
        eq(auditLogs.action, 'privacy_request.created'),
      ),
    )
    .limit(1);
  return row?.locale === 'en' ? 'en' : 'vi';
}

export type PrivacyNotification = {
  email: string;
  locale: 'vi' | 'en';
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  dueAt: Date;
  note: string | null;
};

/** Data for a `privacy.notify` e-mail; null when the request no longer exists. */
export async function getPrivacyNotification(
  db: Pick<Database, 'select'>,
  requestId: string,
): Promise<PrivacyNotification | null> {
  const [row] = await db
    .select(requestColumns)
    .from(privacyRequests)
    .where(eq(privacyRequests.id, requestId))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email,
    locale: await requesterLocale(db, row.userId, requestId),
    type: row.type,
    status: row.status,
    dueAt: row.dueAt,
    note: row.note,
  };
}

// ---------- Admin queue (Owner: privacyRequests.handle) ----------

export type AdminPrivacyRequestRow = PrivacyRequestView & { hasAccount: boolean };

export async function listPrivacyRequests(
  db: Pick<Database, 'select'>,
  query: PrivacyRequestListQuery,
  now: Date = new Date(),
): Promise<Paged<AdminPrivacyRequestRow>> {
  const q = privacyRequestListSchema.parse(query);
  const conditions: (SQL | undefined)[] = [];
  const open = inArray(privacyRequests.status, [...OPEN_PRIVACY_STATUSES]);
  switch (q.filter) {
    case 'open':
      conditions.push(open);
      break;
    case 'overdue':
      conditions.push(open, lt(privacyRequests.dueAt, now));
      break;
    case 'completed':
    case 'rejected':
      conditions.push(eq(privacyRequests.status, q.filter));
      break;
  }
  if (q.type) conditions.push(eq(privacyRequests.type, q.type));
  if (q.q) conditions.push(ilike(privacyRequests.email, containsPattern(q.q)));
  const where = and(...conditions);
  const [rows, [total]] = await Promise.all([
    db
      .select(requestColumns)
      .from(privacyRequests)
      .where(where)
      // Open queue: most urgent first; history: newest first.
      .orderBy(
        ...(q.filter === 'open' || q.filter === 'overdue'
          ? [privacyRequests.dueAt, privacyRequests.createdAt]
          : [desc(privacyRequests.createdAt)]),
      )
      .limit(q.pageSize)
      .offset(pageOffset(q.page, q.pageSize)),
    db.select({ n: count() }).from(privacyRequests).where(where),
  ]);
  return {
    rows: rows.map((row) => ({ ...toView(row, now), hasAccount: !!row.userId })),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Open requests and those past their legal due date (dashboard / nav badge). */
export async function countOpenPrivacyRequests(
  db: Pick<Database, 'select'>,
  now: Date = new Date(),
): Promise<{ open: number; overdue: number }> {
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${privacyRequests.dueAt} < ${now.toISOString()}::timestamptz)::int`,
    })
    .from(privacyRequests)
    .where(inArray(privacyRequests.status, [...OPEN_PRIVACY_STATUSES]));
  return { open: row?.open ?? 0, overdue: row?.overdue ?? 0 };
}

export type PrivacyRequestHistoryEntry = {
  action: string;
  actorName: string | null;
  createdAt: Date;
  diff: unknown;
};

export type AdminPrivacyRequestDetail = AdminPrivacyRequestRow & {
  account: { name: string; role: string; deleted: boolean } | null;
  openOrders: number;
  history: PrivacyRequestHistoryEntry[];
};

export async function getPrivacyRequestDetail(
  db: Pick<Database, 'select'>,
  id: string,
): Promise<AdminPrivacyRequestDetail | null> {
  const [row] = await db
    .select(requestColumns)
    .from(privacyRequests)
    .where(eq(privacyRequests.id, id))
    .limit(1);
  if (!row) return null;
  const [account] = row.userId
    ? await db
        .select({ name: users.name, role: users.role, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1)
    : [];
  const [openOrders, history] = await Promise.all([
    countOpenOrdersForSubject(db, { userId: row.userId, email: row.email }),
    db
      .select({
        action: auditLogs.action,
        actorName: users.name,
        createdAt: auditLogs.createdAt,
        diff: auditLogs.diff,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.entityType, 'privacy_request'), eq(auditLogs.entityId, id)))
      .orderBy(auditLogs.createdAt, auditLogs.id),
  ]);
  return {
    ...toView(row),
    hasAccount: !!row.userId,
    account: account
      ? { name: account.name, role: account.role, deleted: !!account.deletedAt }
      : null,
    openOrders,
    history,
  };
}

async function lockRequest(tx: Tx, id: string) {
  const [row] = await tx
    .select(requestColumns)
    .from(privacyRequests)
    .where(eq(privacyRequests.id, id))
    .for('update');
  if (!row) throw new DomainError('notFound');
  return row;
}

const TAGS: string[] = [];

/** Start, complete or reject a request (rejection needs a reason, sent to the requester). */
export async function setPrivacyRequestStatus(
  ctx: CommandContext,
  input: { id: string; status: Exclude<PrivacyRequestStatus, 'received'>; note?: string },
): Promise<CommandResult<{ status: PrivacyRequestStatus }>> {
  assertCan(ctx.actor, 'privacyRequests.handle');
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, input.id);
    if (!canTransitionPrivacyRequest(row.status, input.status)) {
      throw new DomainError('conflict', [{ path: 'status', code: 'invalidTransition' }]);
    }
    const note = input.note?.trim() || null;
    if (input.status === 'rejected' && !note) {
      throw new DomainError('invalid', [{ path: 'note', code: 'rejectReasonRequired' }]);
    }
    if (input.status === 'completed' && row.type === 'delete') {
      // Deletion is completed only by the anonymisation command.
      throw new DomainError('invalid', [{ path: 'status', code: 'useAnonymize' }]);
    }
    const done = input.status === 'completed' || input.status === 'rejected';
    await tx
      .update(privacyRequests)
      .set({
        status: input.status,
        handledBy: ctx.actor.id,
        completedAt: done ? new Date() : null,
        ...(note ? { note } : {}),
      })
      .where(eq(privacyRequests.id, input.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: `privacy_request.${input.status}`,
      entityType: 'privacy_request',
      entityId: input.id,
      diff: { status: { from: row.status, to: input.status }, ...(note ? { note } : {}) },
      ip: ctx.ip ?? null,
    });
    if (done) {
      await enqueue(ctx.boss, tx, 'privacy.notify', {
        requestId: input.id,
        kind: input.status as 'completed' | 'rejected',
      });
    }
    return { data: { status: input.status }, tags: TAGS };
  });
}

/** Produce the export again and e-mail a fresh link (e.g. the first one expired). */
export async function rerunPrivacyExport(
  ctx: CommandContext,
  input: { id: string },
): Promise<CommandResult<null>> {
  assertCan(ctx.actor, 'privacyRequests.handle');
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, input.id);
    if (row.type !== 'export')
      throw new DomainError('invalid', [{ path: 'id', code: 'notExport' }]);
    if (row.status === 'rejected') throw new DomainError('conflict');
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'privacy_request.export_sent',
      entityType: 'privacy_request',
      entityId: input.id,
      ip: ctx.ip ?? null,
    });
    await enqueue(ctx.boss, tx, 'privacy.export', { requestId: input.id });
    return { data: null, tags: TAGS };
  });
}

/**
 * Steps contributed by other modules (reviews, notification logs, return photos) to the
 * anonymisation; they run first, inside the same transaction.
 */
export type ErasureStep = (tx: Tx, subject: PrivacySubject) => Promise<void>;

export type AnonymizeResult = {
  ordersAnonymized: number;
  accountAnonymized: boolean;
};

/**
 * Deletion request → anonymisation (§10.6, §11.2): refused while orders are still open (the
 * shop needs the address to deliver) and for staff accounts. Personal data is removed from the
 * account, addresses, wishlist, carts, sessions, newsletter, consent identifiers and orders;
 * accounting data stays. Completes the request and e-mails the requester.
 */
export async function anonymizePrivacySubject(
  ctx: CommandContext,
  input: { id: string; confirmEmail: string; note?: string },
  steps: readonly ErasureStep[] = [],
): Promise<CommandResult<AnonymizeResult>> {
  assertCan(ctx.actor, 'privacyRequests.handle');
  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, input.id);
    if (row.type !== 'delete')
      throw new DomainError('invalid', [{ path: 'id', code: 'notDelete' }]);
    if (!(OPEN_PRIVACY_STATUSES as readonly string[]).includes(row.status)) {
      throw new DomainError('conflict', [{ path: 'status', code: 'invalidTransition' }]);
    }
    if (input.confirmEmail.trim().toLowerCase() !== row.email.toLowerCase()) {
      throw new DomainError('invalid', [{ path: 'confirmEmail', code: 'confirmMismatch' }]);
    }

    let userId = row.userId;
    if (!userId) {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, row.email))
        .limit(1);
      userId = user?.id ?? null;
    }
    let locale: 'vi' | 'en' = 'vi';
    if (userId) {
      const [user] = await tx
        .select({ role: users.role, locale: users.locale })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (user && user.role !== 'customer') {
        throw new DomainError('forbidden', [{ path: 'id', code: 'staffAccount' }]);
      }
      locale = user?.locale ?? 'vi';
    }
    const subject: PrivacySubject = { userId, email: row.email };
    const openOrders = await countOpenOrdersForSubject(tx, subject);
    if (openOrders > 0) {
      throw new DomainError('conflict', [{ path: 'id', code: 'openOrders' }]);
    }

    // Other modules' steps first: they still find the subject's orders by e-mail, which the
    // order anonymisation replaces (return photos, M3 wave 3).
    for (const step of steps) await step(tx, subject);
    const ordersAnonymized = await anonymizeOrdersForSubject(tx, subject);
    if (userId) await deleteCartsForUser(tx, userId);
    const erased = await eraseCustomerData(tx, subject, { locale });

    const note = input.note?.trim() || null;
    await tx
      .update(privacyRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
        handledBy: ctx.actor.id,
        userId,
        ...(note ? { note } : {}),
      })
      .where(eq(privacyRequests.id, input.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'privacy_request.anonymized',
      entityType: 'privacy_request',
      entityId: input.id,
      diff: {
        status: { from: row.status, to: 'completed' },
        ordersAnonymized,
        accountAnonymized: erased.userAnonymized,
        addressesRemoved: erased.addresses,
        consentsRedacted: erased.consentsRedacted,
        ...(note ? { note } : {}),
      },
      ip: ctx.ip ?? null,
    });
    await enqueue(ctx.boss, tx, 'privacy.notify', { requestId: input.id, kind: 'completed' });
    return {
      data: { ordersAnonymized, accountAnonymized: erased.userAnonymized },
      tags: TAGS,
    };
  });
}

/** Request behind an export download: whose data, and whether it may be downloaded. */
export async function getExportRequest(
  db: Pick<Database, 'select'>,
  requestId: string,
): Promise<{
  userId: string | null;
  email: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  completedAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      userId: privacyRequests.userId,
      email: privacyRequests.email,
      type: privacyRequests.type,
      status: privacyRequests.status,
      completedAt: privacyRequests.completedAt,
    })
    .from(privacyRequests)
    .where(eq(privacyRequests.id, requestId))
    .limit(1);
  return row ?? null;
}
