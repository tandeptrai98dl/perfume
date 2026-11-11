import type { ReactNode } from 'react';
import { Text } from 'react-email';

import { emailFormatter, emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, mutedTextStyle, textStyle } from './layout';
import { DeliveryAddress, OrderItems, OrderTotals, type OrderEmailData } from './order-parts';

/** Follow-up e-mails after the confirmation (§10.5), in the order's locale. */
export const ORDER_UPDATE_KINDS = [
  'paymentReceived',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'updated',
] as const;
export type OrderUpdateKind = (typeof ORDER_UPDATE_KINDS)[number];

export type ShipmentEmailData = {
  carrier: 'self' | 'ghn' | 'ghtk' | 'viettel_post' | 'other';
  trackingCode: string;
  trackingUrl: string | null;
};

export type OrderUpdateProps = {
  locale: EmailLocale;
  kind: OrderUpdateKind;
  order: OrderEmailData;
  orderUrl: string;
  /** Amount of the payment that triggered `paymentReceived`. */
  paymentAmount?: number;
  shipment?: ShipmentEmailData | null;
  /** `updated`: amount still to pay online after the edit, and where to pay it. */
  amountDueOnline?: number;
  payUrl?: string | null;
};

export function orderUpdateSubject(locale: EmailLocale, kind: OrderUpdateKind, code: string) {
  return emailTranslator(locale)(`email.order.${kind}.subject`, { code });
}

export function OrderUpdateEmail({
  locale,
  kind,
  order,
  orderUrl,
  paymentAmount,
  shipment,
  amountDueOnline = 0,
  payUrl = null,
}: OrderUpdateProps) {
  const t = emailTranslator(locale);
  const f = emailFormatter(locale);
  const code = order.code;

  let body: ReactNode;
  switch (kind) {
    case 'paymentReceived': {
      const amount = f.money(paymentAmount ?? order.amountPaid);
      body = (
        <>
          <Text style={textStyle}>{t('email.order.paymentReceived.body', { amount, code })}</Text>
          <Text style={textStyle}>
            {order.amountDue > 0
              ? t('email.order.paymentReceived.balance', { amount: f.money(order.amountDue) })
              : t('email.order.paymentReceived.fullyPaid')}
          </Text>
        </>
      );
      break;
    }
    case 'shipped':
      body = (
        <>
          <Text style={textStyle}>
            {t('email.order.shipped.body', {
              code,
              carrier: t(`customerOrder.carrier.${shipment?.carrier ?? 'other'}`),
            })}
          </Text>
          {shipment && (
            <Text style={textStyle}>
              {t('email.order.shipped.tracking', { code: shipment.trackingCode })}
            </Text>
          )}
          {order.amountDue > 0 && (
            <Text style={textStyle}>
              {t('email.order.shipped.codBalance', { amount: f.money(order.amountDue) })}
            </Text>
          )}
          {shipment?.trackingUrl && (
            <EmailButton href={shipment.trackingUrl}>{t('email.order.shipped.track')}</EmailButton>
          )}
        </>
      );
      break;
    case 'delivered':
      body = (
        <>
          <Text style={textStyle}>{t('email.order.delivered.body', { code })}</Text>
          <Text style={textStyle}>{t('email.order.delivered.review')}</Text>
          <Text style={mutedTextStyle}>{t('email.order.delivered.returns')}</Text>
        </>
      );
      break;
    case 'cancelled':
      body = (
        <>
          <Text style={textStyle}>{t('email.order.cancelled.body', { code })}</Text>
          {order.amountPaid > order.amountRefunded && (
            <Text style={textStyle}>
              {t('email.order.cancelled.refund', {
                amount: f.money(order.amountPaid - order.amountRefunded),
              })}
            </Text>
          )}
          <Text style={mutedTextStyle}>{t('email.order.cancelled.help')}</Text>
        </>
      );
      break;
    case 'refunded':
      body = (
        <>
          <Text style={textStyle}>{t('email.order.refunded.body', { code })}</Text>
          {order.amountPaid > 0 && (
            <Text style={textStyle}>
              {t('email.order.refunded.refund', {
                amount: f.money(Math.max(order.amountRefunded, order.amountPaid)),
              })}
            </Text>
          )}
        </>
      );
      break;
    case 'updated':
      body = (
        <>
          <Text style={textStyle}>{t('email.order.updated.body', { code })}</Text>
          {amountDueOnline > 0 && (
            <Text style={textStyle}>
              {t('email.order.updated.payDifference', { amount: f.money(amountDueOnline) })}
            </Text>
          )}
          {amountDueOnline > 0 && payUrl && (
            <EmailButton href={payUrl}>{t('email.order.updated.pay')}</EmailButton>
          )}
          {order.amountPaid - order.amountRefunded > order.total && (
            <Text style={textStyle}>
              {t('email.order.updated.refund', {
                amount: f.money(order.amountPaid - order.amountRefunded - order.total),
              })}
            </Text>
          )}
          <Text style={mutedTextStyle}>{t('email.order.updated.help')}</Text>
        </>
      );
      break;
  }

  return (
    <EmailLayout
      locale={locale}
      preview={t(`email.order.${kind}.preview`, {
        amount: f.money(paymentAmount ?? order.amountPaid),
      })}
      heading={t(`email.order.${kind}.heading`)}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t('email.layout.greeting', { name: order.customerName })}</Text>
      {body}
      <EmailButton href={orderUrl}>{t('email.order.viewOrder')}</EmailButton>
      {(kind === 'shipped' || kind === 'cancelled' || kind === 'updated') && (
        <>
          <OrderItems order={order} t={t} f={f} />
          <OrderTotals order={order} t={t} f={f} />
        </>
      )}
      {(kind === 'shipped' || kind === 'updated') && <DeliveryAddress order={order} t={t} />}
    </EmailLayout>
  );
}
