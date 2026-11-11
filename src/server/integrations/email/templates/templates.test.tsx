import { render, toPlainText } from 'react-email';
import { describe, expect, it } from 'vitest';

import { AuthEmail, authEmailSubject } from './auth-email';
import {
  OrderConfirmationEmail,
  orderConfirmationSubject,
  paymentInstructionFor,
} from './order-confirmation';
import type { OrderEmailData } from './order-parts';
import { ORDER_UPDATE_KINDS, OrderUpdateEmail, orderUpdateSubject } from './order-update';

const ORDER: OrderEmailData = {
  code: 'PF-261111-7K3Q',
  customerName: 'Nguyễn Thị Hương',
  placedAt: new Date('2026-11-11T03:00:00Z'),
  paymentMethod: 'cod',
  subtotal: 6_400_000,
  discountTotal: 200_000,
  shippingFee: 0,
  giftWrapFee: 50_000,
  total: 6_250_000,
  depositRequired: 1_250_000,
  amountPaid: 0,
  amountDue: 6_250_000,
  amountRefunded: 0,
  items: [
    {
      productName: 'Cèdre Nocturne EDT',
      variantLabel: '100 ml',
      quantity: 2,
      lineTotal: 6_400_000,
    },
  ],
  shippingAddress: {
    fullName: 'Nguyễn Thị Hương',
    street: '12 Hàng Bạc',
    wardName: 'Phường Hoàn Kiếm',
    provinceName: 'Thành phố Hà Nội',
  },
};

const LOCALES = ['vi', 'en'] as const;

/** Intl puts a no-break space between the amount and "₫". */
const plain = (html: string) => toPlainText(html).replace(/\u00a0/g, ' ');

describe('order e-mail templates', () => {
  it.each(LOCALES)(
    'renders the confirmation in %s with items, totals and the link',
    async (locale) => {
      const html = await render(
        <OrderConfirmationEmail locale={locale} order={ORDER} orderUrl="https://shop.test/o?t=x" />,
      );
      const text = plain(html);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('https://shop.test/o?t=x');
      expect(text).toContain('Cèdre Nocturne EDT');
      expect(text).toContain(locale === 'vi' ? '6.250.000 ₫' : '₫6,250,000');
      // COD above the threshold: deposit instructions with the deposit amount.
      expect(text).toContain(locale === 'vi' ? '1.250.000 ₫' : '₫1,250,000');
      expect(orderConfirmationSubject(locale, ORDER.code)).toContain(ORDER.code);
    },
  );

  it.each(LOCALES.flatMap((locale) => ORDER_UPDATE_KINDS.map((kind) => [locale, kind] as const)))(
    'renders %s %s without missing messages',
    async (locale, kind) => {
      const html = await render(
        <OrderUpdateEmail
          locale={locale}
          kind={kind}
          order={{ ...ORDER, amountPaid: 1_250_000, amountDue: 5_000_000 }}
          orderUrl="https://shop.test/o"
          paymentAmount={1_250_000}
          shipment={{ carrier: 'ghn', trackingCode: 'GHN123', trackingUrl: 'https://track/GHN123' }}
        />,
      );
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(ORDER.code);
      expect(orderUpdateSubject(locale, kind, ORDER.code)).toContain(ORDER.code);
      if (kind === 'shipped') {
        expect(html).toContain('GHN123');
        expect(html).toContain('https://track/GHN123');
      }
    },
  );

  it('uses different copy per locale', async () => {
    const vi = toPlainText(
      await render(<OrderUpdateEmail locale="vi" kind="delivered" order={ORDER} orderUrl="u" />),
    );
    const en = toPlainText(
      await render(<OrderUpdateEmail locale="en" kind="delivered" order={ORDER} orderUrl="u" />),
    );
    expect(vi).toContain('đã được giao');
    expect(en).toContain('has been delivered');
  });

  it('picks payment instructions from method and amounts', () => {
    expect(paymentInstructionFor(ORDER)).toBe('codDeposit');
    expect(paymentInstructionFor({ ...ORDER, depositRequired: 0 })).toBe('cod');
    expect(paymentInstructionFor({ ...ORDER, paymentMethod: 'vnpay' })).toBe('online');
    expect(paymentInstructionFor({ ...ORDER, paymentMethod: 'bank_transfer' })).toBe(
      'bankTransfer',
    );
    expect(paymentInstructionFor({ ...ORDER, amountPaid: 6_250_000, amountDue: 0 })).toBe('paid');
  });
});

describe('auth e-mail templates', () => {
  it.each(
    LOCALES.flatMap((locale) =>
      (['verify_email', 'reset_password'] as const).map((kind) => [locale, kind] as const),
    ),
  )('renders %s %s with the action link', async (locale, kind) => {
    const html = await render(
      <AuthEmail locale={locale} kind={kind} url="https://shop.test/a?token=1" />,
    );
    expect(html).toContain('https://shop.test/a?token=1');
    expect(html).toContain(`lang="${locale}"`);
    expect(authEmailSubject(locale, kind).length).toBeGreaterThan(3);
  });

  it('states the 30-minute validity of reset links', async () => {
    const vi = toPlainText(await render(<AuthEmail locale="vi" kind="reset_password" url="u" />));
    const en = toPlainText(await render(<AuthEmail locale="en" kind="reset_password" url="u" />));
    expect(vi).toContain('30 phút');
    expect(en).toContain('30 minutes');
  });
});
