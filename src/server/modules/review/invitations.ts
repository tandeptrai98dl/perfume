import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { createElement } from 'react';

import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';
import { orderEvents, orderItems, orders, reviewInvitations, reviews } from '@/server/db/schema';
import type { EmailSender } from '@/server/integrations/email/send';
import { enqueue } from '@/server/jobs/queue';
import {
  ReviewInvitationEmail,
  reviewInvitationSubject,
  type ReviewInvitationItem,
} from '@/server/integrations/email/templates/review-invitation';
import { logger } from '@/server/lib/logger';
import { EMAIL_SENT_EVENT } from '@/server/modules/notification';
import { recordOrderEvent } from '@/server/modules/order';

import {
  hashReviewToken,
  INVITATION_DELAY_SECONDS,
  INVITATION_TTL_DAYS,
  invitationExpiry,
  isReviewableOrderStatus,
  newReviewToken,
} from './rules';

/*
 * Review invitations after delivery (ADR-0008, §10.5), sent by the worker (`review.invite`):
 * - guest orders: one `review_invitations` row per purchased line that has no review yet (token
 *   stored hashed, 30 days), e-mailed as one link per line;
 * - member orders: an e-mail pointing to "Reviews to write" in the account.
 * At most once per order: the send runs under an advisory lock and is recorded in the order
 * timeline (`email_sent`, key `review_invitation`) in the same transaction as the invitation
 * rows. A failed send rolls the rows back, so a retry issues fresh tokens (only hashes are
 * stored; the raw token exists only in the e-mail).
 */

export const REVIEW_INVITATION_KEY = 'review_invitation';

export type InvitationDeps = {
  db: Database;
  email: EmailSender;
  /** Public site origin for links (APP_URL). */
  appUrl: string;
  now?: () => Date;
};

export type InvitationOutcome =
  'sent' | 'already_sent' | 'missing' | 'not_reviewable' | 'no_email' | 'nothing_to_review';

export function reviewLinkUrl(appUrl: string, locale: 'vi' | 'en', token: string): string {
  return absoluteUrl(appUrl, localizedPath(locale, '/review/[token]', { token }));
}

export function accountReviewsUrl(appUrl: string, locale: 'vi' | 'en'): string {
  return absoluteUrl(appUrl, localizedPath(locale, '/account/reviews'));
}

/**
 * Called for every `order.status-changed`: the first real delivery (`shipped → delivered`)
 * schedules `review.invite` a few days later. A duplicate job is harmless (the send is
 * recorded once per order).
 */
export async function scheduleReviewInvitation(
  deps: { db: Pick<Database, 'execute'>; boss: PgBoss },
  change: { orderId: string; from: string; to: string },
  options: { delaySeconds?: number } = {},
): Promise<boolean> {
  if (change.to !== 'delivered' || change.from !== 'shipped') return false;
  await enqueue(
    deps.boss,
    deps.db,
    'review.invite',
    { orderId: change.orderId },
    { startAfter: options.delaySeconds ?? INVITATION_DELAY_SECONDS },
  );
  return true;
}

export async function sendReviewInvitations(
  deps: InvitationDeps,
  orderId: string,
): Promise<InvitationOutcome> {
  const now = deps.now?.() ?? new Date();
  return deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`notify:${orderId}:${REVIEW_INVITATION_KEY}`}, 0))`,
    );
    const [order] = await tx
      .select({
        id: orders.id,
        code: orders.code,
        userId: orders.userId,
        email: orders.email,
        locale: orders.locale,
        status: orders.status,
        customerName: orders.customerName,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) {
      logger.warn('review_invitation.order_missing', { orderId });
      return 'missing';
    }
    // Returned or a return in progress since delivery: no invitation.
    if (!isReviewableOrderStatus(order.status)) return 'not_reviewable';
    if (!order.email) return 'no_email';

    const [already] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, orderId),
          eq(orderEvents.type, EMAIL_SENT_EVENT),
          sql`${orderEvents.metadata}->>'key' = ${REVIEW_INVITATION_KEY}`,
        ),
      )
      .limit(1);
    if (already) return 'already_sent';

    const lines = await tx
      .select({
        id: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
      })
      .from(orderItems)
      .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
      .where(and(eq(orderItems.orderId, orderId), isNull(reviews.id)))
      .orderBy(orderItems.createdAt, orderItems.id);
    if (lines.length === 0) return 'nothing_to_review';

    const kind = order.userId ? 'member' : 'guest';
    let items: ReviewInvitationItem[] = lines.map((line) => ({
      productName: line.productName,
      variantLabel: line.variantLabel,
    }));
    if (kind === 'guest') {
      const expiresAt = invitationExpiry(now);
      const tokens = new Map<string, string>();
      for (const line of lines) {
        const token = newReviewToken();
        // A line invited before (e.g. delivered → return rejected → delivered) gets a fresh
        // link unless it was already used.
        const [row] = await tx
          .insert(reviewInvitations)
          .values({
            orderItemId: line.id,
            email: order.email,
            tokenHash: hashReviewToken(token),
            expiresAt,
          })
          .onConflictDoUpdate({
            target: reviewInvitations.orderItemId,
            set: {
              email: order.email,
              tokenHash: hashReviewToken(token),
              expiresAt,
            },
            setWhere: isNull(reviewInvitations.usedAt),
          })
          .returning({ orderItemId: reviewInvitations.orderItemId });
        if (row) tokens.set(line.id, token);
      }
      items = lines.flatMap((line) => {
        const token = tokens.get(line.id);
        return token
          ? [
              {
                productName: line.productName,
                variantLabel: line.variantLabel,
                url: reviewLinkUrl(deps.appUrl, order.locale, token),
              },
            ]
          : [];
      });
      if (items.length === 0) return 'nothing_to_review';
    }

    await deps.email.send({
      to: order.email,
      subject: reviewInvitationSubject(order.locale, order.code),
      template: createElement(ReviewInvitationEmail, {
        locale: order.locale,
        kind,
        customerName: order.customerName,
        orderCode: order.code,
        items,
        accountUrl: kind === 'member' ? accountReviewsUrl(deps.appUrl, order.locale) : undefined,
        validDays: INVITATION_TTL_DAYS,
      }),
    });
    await recordOrderEvent(tx, {
      orderId,
      type: EMAIL_SENT_EVENT,
      message: REVIEW_INVITATION_KEY,
      actor: { type: 'system', id: null },
      metadata: {
        key: REVIEW_INVITATION_KEY,
        template: REVIEW_INVITATION_KEY,
        locale: order.locale,
        kind,
        items: items.length,
      },
    });
    return 'sent';
  });
}

/** Ids of the lines of an order that hold an unused, unexpired link (tests and admin views). */
export async function activeInvitationItems(
  db: Pick<Database, 'select'>,
  orderId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ orderItemId: reviewInvitations.orderItemId })
    .from(reviewInvitations)
    .innerJoin(orderItems, eq(orderItems.id, reviewInvitations.orderItemId))
    .where(
      and(
        eq(orderItems.orderId, orderId),
        isNull(reviewInvitations.usedAt),
        sql`${reviewInvitations.expiresAt} > ${now}`,
      ),
    );
  return rows.map((row) => row.orderItemId);
}
