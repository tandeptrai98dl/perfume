import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import type { ChatNotifier } from '@/server/integrations/chat/telegram';
import type { EinvoiceProvider } from '@/server/integrations/einvoice';
import type { EmailSender } from '@/server/integrations/email/send';

import type { JobName, JobPayload } from '../definitions';
import { createEinvoiceHandlers } from './einvoice';
import { createOrderNotificationHandlers } from './order-notifications';
import { createOrderTimeoutHandlers } from './order-timeouts';
import { createRevalidateHandler } from './revalidate';
import { createReviewInvitationHandlers } from './review-invitations';
import { createTestEmailHandler } from './test-email';

export type JobHandlers = { [N in JobName]: (payload: JobPayload<N>) => Promise<void> };

export type HandlerDeps = {
  /** Database for handlers that read or change data (worker pool). */
  db: Database;
  /** Producer for follow-up jobs enqueued inside handler transactions (outbox). */
  boss: PgBoss;
  email: EmailSender;
  internalBaseUrl: string;
  internalSecret: string;
  /** Public site origin for links in emails (APP_URL). */
  appUrl: string;
  fetch?: typeof fetch;
  // ---------- M2 notifications (all optional: channels are skipped when unset) ----------
  /** Signs `?t=` order links in e-mails (BETTER_AUTH_SECRET, like the web app). */
  orderLinkSecret?: string;
  /** Internal alert recipient (STAFF_ALERT_EMAIL). */
  staffAlertEmail?: string;
  /** Telegram bot credentials (ADR-0019); ignored when `chat` is given. */
  telegramBotToken?: string;
  telegramChatId?: string;
  /** Injected chat channel (tests); `null` disables Telegram. */
  chat?: ChatNotifier | null;
  // ---------- M3 e-invoicing ----------
  /** E-invoice provider from env (`createEinvoiceProvider`); null = not configured. */
  einvoice?: EinvoiceProvider | null;
};

/** One handler per job; the map type guarantees every job in JOBS is handled. */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  const orderNotifications = createOrderNotificationHandlers(deps);
  const reviewInvitations = createReviewInvitationHandlers(deps);
  return {
    'system.test-email': createTestEmailHandler(deps.email),
    'cache.revalidate': createRevalidateHandler({
      baseUrl: deps.internalBaseUrl,
      secret: deps.internalSecret,
      fetch: deps.fetch,
    }),
    ...orderNotifications,
    ...createOrderTimeoutHandlers(deps),
    ...createEinvoiceHandlers(deps),
    // M3 reviews: the status e-mail first, then the review invitation on first delivery.
    'order.status-changed': async (payload) => {
      await orderNotifications['order.status-changed'](payload);
      await reviewInvitations.onStatusChanged(payload);
    },
    'review.invite': reviewInvitations['review.invite'],
  };
}
