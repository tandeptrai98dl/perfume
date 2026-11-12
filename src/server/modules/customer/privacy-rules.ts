import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/*
 * Data-subject request rules (PDPL 91/2025/QH15, Decree 356/2025/ND-CP art. 5). Pure and
 * secret-injected: used by Server Actions, the worker and tests alike (ADR-0023).
 *
 * Deadlines (calendar days from receipt; Decree 356/2025): access / provision of data and
 * correction within 10 days, withdrawal of consent within 15 days (answered within 2 working
 * days: the confirmation e-mail goes out immediately), deletion within 20 days. Extensions for
 * requests involving processors (15 / 20 / 30 days) are a staff decision noted on the request.
 */

export const PRIVACY_REQUEST_TYPES = ['export', 'delete', 'correct', 'withdraw_consent'] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = [
  'received',
  'in_progress',
  'completed',
  'rejected',
] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export const OPEN_PRIVACY_STATUSES = ['received', 'in_progress'] as const;

export const PRIVACY_DUE_DAYS: Record<PrivacyRequestType, number> = {
  export: 10,
  correct: 10,
  withdraw_consent: 15,
  delete: 20,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function privacyDueAt(type: PrivacyRequestType, receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + PRIVACY_DUE_DAYS[type] * DAY_MS);
}

export function isOverdue(
  request: { status: string; dueAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    (OPEN_PRIVACY_STATUSES as readonly string[]).includes(request.status) &&
    request.dueAt.getTime() < now.getTime()
  );
}

const TRANSITIONS: Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]> = {
  received: ['in_progress', 'completed', 'rejected'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

export function canTransitionPrivacyRequest(
  from: PrivacyRequestStatus,
  to: PrivacyRequestStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---------- Export download links ----------

/** A personal-data export link (e-mail or account) stays valid this long. */
export const PRIVACY_EXPORT_LINK_DAYS = 7;

export function exportLinkExpiry(from: Date): Date {
  return new Date(from.getTime() + PRIVACY_EXPORT_LINK_DAYS * DAY_MS);
}

/** A completed export can be downloaded from the account during the link window. */
export function isExportDownloadable(
  request: { type: string; status: string; completedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    request.type === 'export' &&
    request.status === 'completed' &&
    !!request.completedAt &&
    exportLinkExpiry(request.completedAt).getTime() > now.getTime()
  );
}

function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signExportLink(secret: string, requestId: string, expiresAt: Date) {
  const e = String(Math.floor(expiresAt.getTime() / 1000));
  return { e, t: hmac(secret, `privacy-export:${requestId}:${e}`).slice(0, 43) };
}

export function verifyExportLink(
  secret: string,
  requestId: string,
  e: string | null | undefined,
  t: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!e || !t || !/^\d{1,12}$/.test(e)) return false;
  if (Number(e) * 1000 < now.getTime()) return false;
  return safeEqual(signExportLink(secret, requestId, new Date(Number(e) * 1000)).t, t);
}

// ---------- Guest request verification ----------

/** A guest's request is created only after the e-mail link is opened and confirmed. */
export const GUEST_VERIFICATION_HOURS = 24;

export const MAX_REQUEST_DETAILS = 1000;

const guestRequestPayload = z.object({
  e: z.email().max(254),
  y: z.enum(PRIVACY_REQUEST_TYPES),
  l: z.enum(['vi', 'en']),
  d: z.string().max(MAX_REQUEST_DETAILS).optional(),
  x: z.number().int().positive(),
});

export type GuestPrivacyRequest = {
  email: string;
  type: PrivacyRequestType;
  locale: 'vi' | 'en';
  details: string | null;
};

/** Stateless signed token carried by the verification link (no table needed). */
export function signGuestRequest(
  secret: string,
  request: GuestPrivacyRequest,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      e: request.email,
      y: request.type,
      l: request.locale,
      ...(request.details ? { d: request.details } : {}),
      x: Math.floor(now.getTime() / 1000) + GUEST_VERIFICATION_HOURS * 3600,
    }),
  ).toString('base64url');
  return `${payload}.${hmac(secret, `privacy-guest:${payload}`)}`;
}

export function verifyGuestRequest(
  secret: string,
  token: string | null | undefined,
  now: Date = new Date(),
): GuestPrivacyRequest | null {
  if (!token || token.length > 4096) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(hmac(secret, `privacy-guest:${payload}`), signature)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = guestRequestPayload.safeParse(raw);
  if (!parsed.success || parsed.data.x * 1000 < now.getTime()) return null;
  return {
    email: parsed.data.e,
    type: parsed.data.y,
    locale: parsed.data.l,
    details: parsed.data.d ?? null,
  };
}
