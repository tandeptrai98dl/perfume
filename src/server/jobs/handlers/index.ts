import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import type { ChatNotifier } from '@/server/integrations/chat/telegram';
import type { EmailSender } from '@/server/integrations/email/send';

import type { JobName, JobPayload } from '../definitions';
import { createOrderNotificationHandlers } from './order-notifications';
import { createOrderTimeoutHandlers } from './order-timeouts';
import { createPrivacyHandlers } from './privacy';
import { createRevalidateHandler } from './revalidate';
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
};

/** One handler per job; the map type guarantees every job in JOBS is handled. */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  return {
    'system.test-email': createTestEmailHandler(deps.email),
    'cache.revalidate': createRevalidateHandler({
      baseUrl: deps.internalBaseUrl,
      secret: deps.internalSecret,
      fetch: deps.fetch,
    }),
    ...createOrderNotificationHandlers(deps),
    ...createOrderTimeoutHandlers(deps),
    // M3 privacy stream: data-subject request e-mails and exports.
    ...createPrivacyHandlers(deps),
  };
}
