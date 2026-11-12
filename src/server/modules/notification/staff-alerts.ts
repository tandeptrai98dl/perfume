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
  // M3 wave 2: reviews awaiting moderation (at most one alert per hour).
  'review_pending',
] as const;
export type StaffAlertKind = (typeof STAFF_ALERT_KINDS)[number];

export type StaffAlertOrder = {
  id: string;
  code: string;
  total: number;
  paymentMethod: 'cod' | 'vnpay' | 'payos' | 'bank_transfer' | 'momo' | 'zalopay';
  provinceName: string | null;
};

/**
 * Structured details of the M3 wave 2 alerts, read at send time (catalogue data and counters
 * only, no personal data). The formatter turns them into Vietnamese lines and an admin link.
 */
export type StaffAlertDetails =
  | {
      kind: 'low_stock';
      variantId: string;
      sku: string;
      productName: string;
      available: number;
      threshold: number;
    }
  | { kind: 'review_pending'; pending: number }
  | { kind: 'job_failed'; job: string; id: string; attempts: number };

export type StaffAlert = { title: string; lines: string[]; adminUrl: string; text: string };

function detailLines(t: ReturnType<typeof staffTranslator>, details: StaffAlertDetails): string[] {
  switch (details.kind) {
    case 'low_stock':
      return [
        t('lowStock', {
          sku: details.sku,
          product: details.productName || details.sku,
          available: details.available,
          threshold: details.threshold,
        }),
      ];
    case 'review_pending':
      return [t('reviewPending', { count: details.pending })];
    case 'job_failed':
      return [t('jobFailed', { job: details.job, id: details.id, attempts: details.attempts })];
  }
}

function detailPath(details: StaffAlertDetails): string {
  switch (details.kind) {
    case 'low_stock':
      return `/admin/inventory/movements?variant=${encodeURIComponent(details.variantId)}`;
    case 'review_pending':
      return '/admin/reviews';
    case 'job_failed':
      return '/admin';
  }
}

/** Pure formatter shared by the e-mail and Telegram channels. */
export function buildStaffAlert(input: {
  kind: StaffAlertKind;
  appUrl: string;
  order?: StaffAlertOrder | null;
  message?: string | null;
  details?: StaffAlertDetails | null;
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
  if (input.details) lines.push(...detailLines(t, input.details));
  if (input.message) lines.push(input.message.slice(0, 500));
  if (lines.length === 0) lines.push(t('noDetails'));
  const base = input.appUrl.replace(/\/+$/, '');
  const adminUrl = order
    ? adminOrderUrl(input.appUrl, order.id)
    : input.details
      ? `${base}${detailPath(input.details)}`
      : `${base}/admin`;
  return { title, lines, adminUrl, text: [title, ...lines, adminUrl].join('\n') };
}
