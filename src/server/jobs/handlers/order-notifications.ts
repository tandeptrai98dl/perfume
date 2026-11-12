import { createTelegramNotifier } from '@/server/integrations/chat/telegram';
import {
  handleOrderPlaced,
  sendOrderEdited,
  sendAuthEmail,
  sendPaymentLink,
  sendPaymentReceived,
  sendStaffAlert,
  sendStatusChangeEmail,
  type NotificationDeps,
} from '@/server/modules/notification';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * Customer emails in the order's locale + staff alerts (§10.5, ADR-0019). Idempotent: a
 * retried job never sends the same customer e-mail twice (see notification/once.ts).
 * Owner: M2 stream "notifications & account".
 */
export function createOrderNotificationHandlers(deps: HandlerDeps) {
  const notify: NotificationDeps = {
    db: deps.db,
    email: deps.email,
    appUrl: deps.appUrl,
    orderLinkSecret: deps.orderLinkSecret,
    staffAlertEmail: deps.staffAlertEmail,
    chat:
      deps.chat !== undefined
        ? deps.chat
        : createTelegramNotifier({
            botToken: deps.telegramBotToken,
            chatId: deps.telegramChatId,
            fetch: deps.fetch,
          }),
  };
  return {
    'order.placed': async ({ orderId }: JobPayload<'order.placed'>) => {
      await handleOrderPlaced(notify, orderId);
    },
    'order.status-changed': async (payload: JobPayload<'order.status-changed'>) => {
      await sendStatusChangeEmail(notify, payload);
    },
    'order.updated': async (payload: JobPayload<'order.updated'>) => {
      await sendOrderEdited(notify, payload);
    },
    'payment.received': async (payload: JobPayload<'payment.received'>) => {
      await sendPaymentReceived(notify, payload);
    },
    'staff.alert': async (payload: JobPayload<'staff.alert'>) => {
      await sendStaffAlert(notify, payload);
    },
    'order.payment-link': async (payload: JobPayload<'order.payment-link'>) => {
      await sendPaymentLink(notify, payload);
    },
    'auth.email': async (payload: JobPayload<'auth.email'>) => {
      await sendAuthEmail(notify, payload);
    },
  } as const;
}
