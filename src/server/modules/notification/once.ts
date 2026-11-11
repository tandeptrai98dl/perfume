import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderEvents } from '@/server/db/schema';
import { recordOrderEvent } from '@/server/modules/order';

/**
 * At-most-once delivery per (order, key) for retried jobs: the send runs under a transaction
 * advisory lock, is skipped when the order timeline already records the key, and is recorded
 * in `order_events` (`type`, `metadata.key`) in the same transaction. Only a crash between a
 * successful send and the commit can repeat a message.
 */
export const EMAIL_SENT_EVENT = 'email_sent';
export const STAFF_ALERT_EVENT = 'staff_alert_sent';

export async function sendOnce(
  db: Database,
  input: {
    orderId: string;
    type: typeof EMAIL_SENT_EVENT | typeof STAFF_ALERT_EVENT;
    key: string;
    /** Extra non-PII details for the timeline (template, locale, channels). */
    metadata?: Record<string, unknown>;
    message?: string;
  },
  send: () => Promise<Record<string, unknown> | void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`notify:${input.orderId}:${input.key}`}, 0))`,
    );
    const [existing] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, input.orderId),
          eq(orderEvents.type, input.type),
          sql`${orderEvents.metadata}->>'key' = ${input.key}`,
        ),
      )
      .limit(1);
    if (existing) return false;
    const extra = (await send()) ?? {};
    await recordOrderEvent(tx, {
      orderId: input.orderId,
      type: input.type,
      message: input.message ?? null,
      actor: { type: 'system', id: null },
      metadata: { key: input.key, ...input.metadata, ...extra },
    });
    return true;
  });
}
