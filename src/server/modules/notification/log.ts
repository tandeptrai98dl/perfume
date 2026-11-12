import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { notificationLogs } from '@/server/db/schema';
import { errorFields, logger } from '@/server/lib/logger';
import { maskEmail } from '@/server/lib/mask';

/*
 * Delivery log of every customer/staff e-mail and Telegram message (§6.2 `notification_logs`,
 * owned by this module). A row is written `queued` just before the send and moved to `sent` or
 * `failed`; messages that cannot be sent (no e-mail on a manual order, no alert channel) are
 * logged `skipped`. Recipients are stored masked; errors are reduced to a PII-free summary.
 * Log writes use the root connection (outside the sending transaction, so a failure survives
 * the rollback) and never block or fail a send.
 */

export type NotificationChannel = 'email' | 'telegram' | 'zalo';
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export type NotificationRef = {
  /** Template / message kind, e.g. `order_confirmation`, `shipped`, `staff_alert:new_order`. */
  template: string;
  locale?: 'vi' | 'en' | null;
  refType?: 'order' | 'user' | 'product_variant' | null;
  refId?: string | null;
};

export function maskRecipient(channel: NotificationChannel, value: string | null | undefined) {
  if (!value) return '—';
  if (channel === 'email') return maskEmail(value);
  const tail = value.replace(/\s/g, '').slice(-3);
  return `***${tail}`;
}

const EMAIL_PATTERN = /[^\s@<>"']+@[^\s@<>"']+/g;
const PHONE_PATTERN = /\+?\d[\d\s.-]{7,}\d/g;

/** Error summary safe to store and show: no addresses, phone numbers or URLs with tokens. */
export function errorSummary(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const clean = message
    .replace(EMAIL_PATTERN, '[email]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(PHONE_PATTERN, '[number]');
  return `${name}: ${clean}`.slice(0, 300);
}

async function safely<T>(what: string, write: () => Promise<T>): Promise<T | null> {
  try {
    return await write();
  } catch (error) {
    logger.warn('notification_log.write_failed', { what, ...errorFields(error) });
    return null;
  }
}

/**
 * Sends through `send` with a log row around it. Rethrows the send error (the job retries) after
 * marking the row `failed`.
 */
export async function deliverLogged<T>(
  db: Database,
  input: NotificationRef & { channel: NotificationChannel; recipient: string | null | undefined },
  send: () => Promise<T>,
): Promise<T> {
  const row = await safely('queued', async () => {
    const [inserted] = await db
      .insert(notificationLogs)
      .values({
        channel: input.channel,
        recipient: maskRecipient(input.channel, input.recipient),
        template: input.template.slice(0, 100),
        locale: input.locale ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        status: 'queued',
      })
      .returning({ id: notificationLogs.id });
    return inserted!.id;
  });
  try {
    const result = await send();
    if (row) {
      await safely('sent', () =>
        db
          .update(notificationLogs)
          .set({ status: 'sent', sentAt: new Date() })
          .where(eq(notificationLogs.id, row)),
      );
    }
    return result;
  } catch (error) {
    if (row) {
      await safely('failed', () =>
        db
          .update(notificationLogs)
          .set({ status: 'failed', error: errorSummary(error) })
          .where(eq(notificationLogs.id, row)),
      );
    }
    throw error;
  }
}

/** A message that was not sent on purpose (`reason` is a short code, e.g. `no_recipient`). */
export async function logSkipped(
  db: Database,
  input: NotificationRef & { channel: NotificationChannel; reason: string },
): Promise<void> {
  await safely('skipped', () =>
    db.insert(notificationLogs).values({
      channel: input.channel,
      recipient: '—',
      template: input.template.slice(0, 100),
      locale: input.locale ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      status: 'skipped',
      error: input.reason,
    }),
  );
}

export type NotificationLogRow = {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  template: string;
  locale: 'vi' | 'en' | null;
  status: NotificationStatus;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

/** Newest first; for the admin order detail (`refType = 'order'`). */
export async function listNotificationLogs(
  db: Pick<Database, 'select'>,
  ref: { refType: 'order' | 'user'; refId: string },
  limit = 100,
): Promise<NotificationLogRow[]> {
  return db
    .select({
      id: notificationLogs.id,
      channel: notificationLogs.channel,
      recipient: notificationLogs.recipient,
      template: notificationLogs.template,
      locale: notificationLogs.locale,
      status: notificationLogs.status,
      error: notificationLogs.error,
      sentAt: notificationLogs.sentAt,
      createdAt: notificationLogs.createdAt,
    })
    .from(notificationLogs)
    .where(and(eq(notificationLogs.refType, ref.refType), eq(notificationLogs.refId, ref.refId)))
    .orderBy(desc(notificationLogs.createdAt), desc(notificationLogs.id))
    .limit(limit);
}
