import { Text } from 'react-email';

import { emailFormatter, emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, textStyle } from './layout';
import { DeliveryAddress, OrderItems, OrderTotals, type OrderEmailData } from './order-parts';

export type PaymentInstruction = 'cod' | 'codDeposit' | 'online' | 'bankTransfer' | 'paid';

/** What the customer must do next, from the payment method and what is already paid. */
export function paymentInstructionFor(order: OrderEmailData): PaymentInstruction {
  if (order.amountDue <= 0) return 'paid';
  if (order.paymentMethod === 'cod') {
    return order.depositRequired > order.amountPaid ? 'codDeposit' : 'cod';
  }
  if (order.paymentMethod === 'bank_transfer') return 'bankTransfer';
  return 'online';
}

export function orderConfirmationSubject(locale: EmailLocale, code: string): string {
  return emailTranslator(locale)('email.order.confirmation.subject', { code });
}

/** "Order received" (§10.5): items, totals, payment/deposit instructions, link to the order. */
export function OrderConfirmationEmail({
  locale,
  order,
  orderUrl,
}: {
  locale: EmailLocale;
  order: OrderEmailData;
  orderUrl: string;
}) {
  const t = emailTranslator(locale);
  const f = emailFormatter(locale);
  const instruction = paymentInstructionFor(order);
  return (
    <EmailLayout
      locale={locale}
      preview={t('email.order.confirmation.preview', { code: order.code })}
      heading={t('email.order.confirmation.heading')}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t('email.layout.greeting', { name: order.customerName })}</Text>
      <Text style={textStyle}>
        {t('email.order.confirmation.intro', { code: order.code, date: f.date(order.placedAt) })}
      </Text>
      <Text style={textStyle}>
        {t(`email.order.confirmation.instructions.${instruction}`, {
          code: order.code,
          amount: f.money(order.amountDue),
          deposit: f.money(Math.max(0, order.depositRequired - order.amountPaid)),
        })}
      </Text>
      <EmailButton href={orderUrl}>{t('email.order.viewOrder')}</EmailButton>
      <OrderItems order={order} t={t} f={f} />
      <OrderTotals order={order} t={t} f={f} />
      <DeliveryAddress order={order} t={t} />
    </EmailLayout>
  );
}
