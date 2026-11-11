import { eq } from 'drizzle-orm';
import { createElement } from 'react';

import type { Database } from '@/server/db/client';
import { payments } from '@/server/db/schema';
import type { ChatNotifier } from '@/server/integrations/chat/telegram';
import type { EmailSender } from '@/server/integrations/email/send';
import {
  AuthEmail,
  authEmailSubject,
  type AuthEmailKind,
} from '@/server/integrations/email/templates/auth-email';
import { staffTranslator } from '@/server/integrations/email/templates/i18n';
import {
  OrderConfirmationEmail,
  orderConfirmationSubject,
} from '@/server/integrations/email/templates/order-confirmation';
import type { OrderEmailData } from '@/server/integrations/email/templates/order-parts';
import {
  OrderUpdateEmail,
  orderUpdateSubject,
  type OrderUpdateKind,
} from '@/server/integrations/email/templates/order-update';
import { StaffAlertEmail } from '@/server/integrations/email/templates/staff-alert';
import { errorFields, logger } from '@/server/lib/logger';
import { getOrderViewById, type OrderStatus, type OrderView } from '@/server/modules/order';
import { getCommerceSettings } from '@/server/modules/settings';

import { carrierTrackingUrl, orderPageUrl } from './links';
import { EMAIL_SENT_EVENT, sendOnce, STAFF_ALERT_EVENT } from './once';
import { buildStaffAlert, type StaffAlertKind } from './staff-alerts';

/**
 * Customer e-mails in the order's locale (§10.5, §3.6) and internal alerts (ADR-0019), sent
 * by the worker from outbox jobs. Every customer e-mail is recorded in the order timeline
 * (`order_events.type = 'email_sent'`) and skipped when a retried job finds it there.
 */

export type NotificationDeps = {
  db: Database;
  email: EmailSender;
  /** Public site origin for links (APP_URL). */
  appUrl: string;
  /** Signs `?t=` order links (BETTER_AUTH_SECRET, same as the web app). */
  orderLinkSecret?: string | null;
  /** Internal alert recipient (STAFF_ALERT_EMAIL); the channel is skipped when unset. */
  staffAlertEmail?: string | null;
  /** Telegram bot (TELEGRAM_*); skipped when null. */
  chat?: ChatNotifier | null;
};

function toEmailData(order: OrderView): OrderEmailData {
  return {
    code: order.code,
    customerName: order.customerName,
    placedAt: order.placedAt,
    paymentMethod: order.paymentMethod,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    depositRequired: order.depositRequired,
    amountPaid: order.amountPaid,
    amountDue: order.amountDue,
    amountRefunded: order.amountRefunded,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantLabel: item.variantLabel,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    shippingAddress: order.shippingAddress,
  };
}

async function loadOrder(db: Database, orderId: string): Promise<OrderView | null> {
  const order = await getOrderViewById(db, orderId);
  // A deleted order cannot be mailed; acknowledge the job instead of retrying forever.
  if (!order) logger.warn('notification.order_missing', { orderId });
  return order;
}

/** Manual (phone/Zalo) orders may have no e-mail: nothing to send, the job succeeds. */
async function loadMailableOrder(db: Database, orderId: string): Promise<OrderView | null> {
  const order = await loadOrder(db, orderId);
  if (order && !order.email) {
    logger.info('notification.no_customer_email', { orderId });
    return null;
  }
  return order;
}

/** Order confirmation (`order.placed`). Returns false when it was already sent. */
export async function sendOrderConfirmation(deps: NotificationDeps, orderId: string) {
  const order = await loadMailableOrder(deps.db, orderId);
  if (!order) return false;
  const locale = order.locale;
  return sendOnce(
    deps.db,
    {
      orderId,
      type: EMAIL_SENT_EVENT,
      key: 'order_confirmation',
      message: 'order_confirmation',
      metadata: { template: 'order_confirmation', locale },
    },
    async () => {
      await deps.email.send({
        to: order.email,
        subject: orderConfirmationSubject(locale, order.code),
        template: createElement(OrderConfirmationEmail, {
          locale,
          order: toEmailData(order),
          orderUrl: orderPageUrl({ ...linkOptions(deps), locale, code: order.code }),
        }),
      });
    },
  );
}

function linkOptions(deps: NotificationDeps) {
  return { appUrl: deps.appUrl, secret: deps.orderLinkSecret };
}

/** Which follow-up e-mail a status change sends (none for internal steps). */
export function emailForTransition(from: string, to: OrderStatus): OrderUpdateKind | null {
  switch (to) {
    case 'shipped':
      return 'shipped';
    // Only the real delivery: a rejected return also moves back to `delivered`.
    case 'delivered':
      return from === 'shipped' ? 'delivered' : null;
    case 'cancelled':
      return 'cancelled';
    case 'returned':
      return 'refunded';
    default:
      return null;
  }
}

export async function sendOrderUpdate(
  deps: NotificationDeps,
  input: { orderId: string; kind: OrderUpdateKind; key: string; paymentAmount?: number },
) {
  const order = await loadMailableOrder(deps.db, input.orderId);
  if (!order) return false;
  const locale = order.locale;
  const latest = order.shipments.at(-1);
  return sendOnce(
    deps.db,
    {
      orderId: input.orderId,
      type: EMAIL_SENT_EVENT,
      key: input.key,
      message: input.kind,
      metadata: { template: input.kind, locale },
    },
    async () => {
      await deps.email.send({
        to: order.email,
        subject: orderUpdateSubject(locale, input.kind, order.code),
        template: createElement(OrderUpdateEmail, {
          locale,
          kind: input.kind,
          order: toEmailData(order),
          orderUrl: orderPageUrl({ ...linkOptions(deps), locale, code: order.code }),
          paymentAmount: input.paymentAmount,
          shipment: latest
            ? {
                carrier: latest.carrier,
                trackingCode: latest.trackingCode,
                trackingUrl: carrierTrackingUrl(latest.carrier, latest.trackingCode),
              }
            : null,
        }),
      });
    },
  );
}

export async function sendStatusChangeEmail(
  deps: NotificationDeps,
  input: { orderId: string; from: string; to: string },
) {
  const kind = emailForTransition(input.from, input.to as OrderStatus);
  if (!kind) return false;
  return sendOrderUpdate(deps, { orderId: input.orderId, kind, key: `status:${input.to}` });
}

/**
 * Payment received (`payment.received`): one e-mail per payment row (deposit, full, balance).
 * Reads the amount from `payments` (owned by the payment module; read-only here).
 */
export async function sendPaymentReceived(
  deps: NotificationDeps,
  input: { orderId: string; paymentId: string },
) {
  const [payment] = await deps.db
    .select({ amount: payments.amount, orderId: payments.orderId })
    .from(payments)
    .where(eq(payments.id, input.paymentId))
    .limit(1);
  if (!payment || payment.orderId !== input.orderId) {
    logger.warn('notification.payment_missing', { orderId: input.orderId });
    return false;
  }
  return sendOrderUpdate(deps, {
    orderId: input.orderId,
    kind: 'paymentReceived',
    key: `payment:${input.paymentId}`,
    paymentAmount: payment.amount,
  });
}

export async function sendAuthEmail(
  deps: Pick<NotificationDeps, 'email'>,
  input: { to: string; locale: 'vi' | 'en'; kind: AuthEmailKind; url: string },
) {
  await deps.email.send({
    to: input.to,
    subject: authEmailSubject(input.locale, input.kind),
    template: createElement(AuthEmail, { locale: input.locale, kind: input.kind, url: input.url }),
  });
}

/**
 * Sends an internal alert to every configured channel. Throws (so the job retries) only when
 * every configured channel failed; a partial failure is logged, so a retry never repeats the
 * channel that already delivered.
 */
export async function sendStaffAlert(
  deps: NotificationDeps,
  input: { kind: StaffAlertKind; orderId?: string; message?: string },
): Promise<string[]> {
  const view = input.orderId ? await getOrderViewById(deps.db, input.orderId) : null;
  const alert = buildStaffAlert({
    kind: input.kind,
    appUrl: deps.appUrl,
    message: input.message,
    order: view
      ? {
          id: view.id,
          code: view.code,
          total: view.total,
          paymentMethod: view.paymentMethod,
          provinceName: view.shippingAddress?.provinceName ?? null,
        }
      : null,
  });
  const t = staffTranslator();

  const channels: Array<[string, () => Promise<unknown>]> = [];
  const staffEmail = deps.staffAlertEmail;
  if (staffEmail) {
    channels.push([
      'email',
      () =>
        deps.email.send({
          to: staffEmail,
          subject: t('subject', { title: alert.title }),
          template: createElement(StaffAlertEmail, {
            heading: t('heading'),
            title: alert.title,
            lines: alert.lines,
            adminUrl: alert.adminUrl,
            adminLabel: t('openAdmin'),
          }),
        }),
    ]);
  }
  const chat = deps.chat;
  if (chat) channels.push(['telegram', () => chat.send(alert.text)]);
  if (channels.length === 0) {
    logger.info('staff_alert.no_channel', { kind: input.kind });
    return [];
  }

  const results = await Promise.allSettled(channels.map(([, send]) => send()));
  const delivered = channels.filter((_, i) => results[i]!.status === 'fulfilled').map(([c]) => c);
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('staff_alert.channel_failed', {
        kind: input.kind,
        channel: channels[i]![0],
        ...errorFields(result.reason),
      });
    }
  });
  if (delivered.length === 0) throw new Error(`Staff alert ${input.kind} failed on every channel`);
  return delivered;
}

/** `order.placed`: customer confirmation + "new order" / "high-value COD" alerts, once each. */
export async function handleOrderPlaced(deps: NotificationDeps, orderId: string) {
  await sendOrderConfirmation(deps, orderId);
  const order = await getOrderViewById(deps.db, orderId);
  if (!order) return;
  const kinds: StaffAlertKind[] = ['new_order'];
  if (order.paymentMethod === 'cod') {
    const settings = await getCommerceSettings(deps.db);
    if (order.total > settings.cod.maxOrderWithoutDeposit) kinds.push('high_value_cod');
  }
  for (const kind of kinds) {
    await sendOnce(
      deps.db,
      { orderId, type: STAFF_ALERT_EVENT, key: `staff:${kind}`, metadata: { kind } },
      async () => ({ channels: await sendStaffAlert(deps, { kind, orderId }) }),
    );
  }
}
