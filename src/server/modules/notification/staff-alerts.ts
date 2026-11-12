import {
  emailFormatter,
  emailTranslator,
  staffTranslator,
} from '@/server/integrations/email/templates/i18n';

import { adminOrderUrl } from './links';

/**
 * Internal alerts (ADR-0019): no personal data beyond order code, amount and province —
 * never names, phones, e-mails or street addresses, in e-mail or Telegram.
 */

export const STAFF_ALERT_KINDS = [
  'new_order',
  'high_value_cod',
  'suspicious_ipn',
  'late_payment_refund',
  'low_stock',
  'job_failed',
  'einvoice_failed',
  'edit_refund',
  // M3 wave 2 returns stream.
  'return_requested',
  'einvoice_adjustment_failed',
] as const;
export type StaffAlertKind = (typeof STAFF_ALERT_KINDS)[number];

export type StaffAlertOrder = {
  id: string;
  code: string;
  total: number;
  paymentMethod: 'cod' | 'vnpay' | 'payos' | 'bank_transfer' | 'momo' | 'zalopay';
  provinceName: string | null;
};

export type StaffAlert = { title: string; lines: string[]; adminUrl: string; text: string };

/** Pure formatter shared by the e-mail and Telegram channels. */
export function buildStaffAlert(input: {
  kind: StaffAlertKind;
  appUrl: string;
  order?: StaffAlertOrder | null;
  message?: string | null;
}): StaffAlert {
  const t = staffTranslator();
  const vi = emailFormatter('vi');
  const title = t(`kinds.${input.kind}`);
  const lines: string[] = [];
  const order = input.order;
  if (order) {
    const values = {
      code: order.code,
      amount: vi.money(order.total),
      method: emailTranslator('vi')(`customerOrder.paymentMethod.${order.paymentMethod}`),
      province: order.provinceName ?? '',
    };
    lines.push(order.provinceName ? t('order', values) : t('orderNoProvince', values));
  }
  if (input.message) lines.push(input.message.slice(0, 500));
  if (lines.length === 0) lines.push(t('noDetails'));
  const adminUrl = order
    ? adminOrderUrl(input.appUrl, order.id)
    : `${input.appUrl.replace(/\/+$/, '')}/admin`;
  return { title, lines, adminUrl, text: [title, ...lines, adminUrl].join('\n') };
}
