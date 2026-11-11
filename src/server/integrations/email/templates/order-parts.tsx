import { Column, Row, Section, Text } from 'react-email';

import type { EmailFormatter, EmailTranslator } from './i18n';
import { EmailRow, eyebrowStyle, mutedTextStyle, textStyle } from './layout';
import { emailTheme as theme } from './theme';

/** Snapshot of an order as e-mails show it (names in the order's locale, integer VND). */
export type OrderEmailData = {
  code: string;
  customerName: string;
  placedAt: Date;
  paymentMethod: 'cod' | 'vnpay' | 'payos' | 'bank_transfer' | 'momo' | 'zalopay';
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountDue: number;
  amountRefunded: number;
  items: Array<{ productName: string; variantLabel: string; quantity: number; lineTotal: number }>;
  shippingAddress: {
    fullName: string;
    street: string;
    wardName: string;
    provinceName: string;
  } | null;
};

type Parts = { t: EmailTranslator; f: EmailFormatter };

export function OrderItems({ order, t, f }: Parts & { order: OrderEmailData }) {
  return (
    <Section>
      <Text style={eyebrowStyle}>{t('email.order.summary.items')}</Text>
      {order.items.map((item, index) => (
        <Row
          key={`${item.productName}-${index}`}
          style={{ borderTop: `1px solid ${theme.color.line200}` }}
        >
          <Column style={{ padding: '12px 0' }}>
            <Text style={{ ...textStyle, margin: 0 }}>{item.productName}</Text>
            <Text style={{ ...mutedTextStyle, margin: 0 }}>
              {item.variantLabel} · {t('email.order.summary.quantity', { quantity: item.quantity })}
            </Text>
          </Column>
          <Column
            style={{
              ...textStyle,
              margin: 0,
              padding: '12px 0',
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
            {f.money(item.lineTotal)}
          </Column>
        </Row>
      ))}
    </Section>
  );
}

export function OrderTotals({ order, t, f }: Parts & { order: OrderEmailData }) {
  return (
    <Section style={{ borderTop: `1px solid ${theme.color.line200}`, paddingTop: '8px' }}>
      <EmailRow label={t('email.order.summary.subtotal')} value={f.money(order.subtotal)} />
      {order.discountTotal > 0 && (
        <EmailRow
          label={t('email.order.summary.discount')}
          value={`−${f.money(order.discountTotal)}`}
        />
      )}
      <EmailRow
        label={t('email.order.summary.shipping')}
        value={
          order.shippingFee > 0 ? f.money(order.shippingFee) : t('email.order.summary.freeShipping')
        }
      />
      {order.giftWrapFee > 0 && (
        <EmailRow label={t('email.order.summary.giftWrap')} value={f.money(order.giftWrapFee)} />
      )}
      <EmailRow label={t('email.order.summary.total')} value={f.money(order.total)} strong />
      {order.amountPaid > 0 && (
        <>
          <EmailRow label={t('email.order.summary.amountPaid')} value={f.money(order.amountPaid)} />
          <EmailRow label={t('email.order.summary.amountDue')} value={f.money(order.amountDue)} />
        </>
      )}
      <EmailRow
        label={t('email.order.summary.paymentMethod')}
        value={t(`customerOrder.paymentMethod.${order.paymentMethod}`)}
      />
    </Section>
  );
}

export function DeliveryAddress({ order, t }: Pick<Parts, 't'> & { order: OrderEmailData }) {
  const address = order.shippingAddress;
  if (!address) return null;
  return (
    <Section>
      <Text style={eyebrowStyle}>{t('email.order.summary.deliverTo')}</Text>
      <Text style={{ ...mutedTextStyle, color: theme.color.ink700 }}>
        {address.fullName}
        <br />
        {address.street}
        <br />
        {address.wardName}, {address.provinceName}
      </Text>
    </Section>
  );
}
