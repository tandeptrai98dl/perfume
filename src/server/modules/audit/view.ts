import { maskEmail, maskPhone } from '@/server/lib/mask';

/*
 * Presentation rules of the audit log viewer and CSV export (§11.2, §12 personal data). Diffs
 * are already redacted by field name when written (`diffRecords`); this layer is defence in
 * depth for every row, old or new: contact-looking field names are replaced, e-mail addresses
 * and phone numbers inside any string are masked, and client IPs are truncated.
 */

export const REDACTED = '[redacted]';
const PII_KEY =
  /^(email|phone|address|street|fullName|customerName|recipient|ip|ipAddress|taxCode|password|token|secret)$/i;
const EMAIL_IN_TEXT = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
/** Vietnamese mobile / landline numbers, with or without +84, spaces, dots or dashes. */
const PHONE_IN_TEXT = /(?<![\w.-])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\w-])/g;
const MAX_DEPTH = 6;

function maskText(value: string): string {
  return value
    .replace(EMAIL_IN_TEXT, (match) => maskEmail(match))
    .replace(PHONE_IN_TEXT, (match) => maskPhone(match));
}

/** Deep copy of an audit diff with PII removed (see module comment). */
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      PII_KEY.test(key) ? redactKey(inner) : redactAuditValue(inner, depth + 1),
    ]),
  );
}

/** A PII field keeps its {from,to} shape so the viewer still shows that it changed. */
function redactKey(value: unknown): unknown {
  if (isChange(value)) return { from: REDACTED, to: REDACTED };
  return REDACTED;
}

/** `203.113.4.17` → `203.113.4.*`; IPv6 keeps its first three groups. */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.*` : '*';
  }
  const groups = ip.split(':').filter(Boolean);
  return `${groups.slice(0, 3).join(':')}:*`;
}

function isChange(value: unknown): value is { from: unknown; to: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'from' in value &&
    'to' in value &&
    Object.keys(value).length === 2
  );
}

export type DiffEntry =
  | { field: string; kind: 'change'; from: unknown; to: unknown }
  | { field: string; kind: 'value'; value: unknown };

/**
 * Flattens a (redacted) diff for display: `{field: {from, to}}` pairs become changes, anything
 * else (counts, references, nested summaries) is shown as a plain value.
 */
export function diffEntries(diff: unknown): DiffEntry[] {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
    return diff === null || diff === undefined ? [] : [{ field: '', kind: 'value', value: diff }];
  }
  return Object.entries(diff).map(([field, value]) =>
    isChange(value)
      ? { field, kind: 'change', from: value.from, to: value.to }
      : { field, kind: 'value', value },
  );
}

/** Admin page of an audited entity, when one exists (§5.2 routes). */
export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case 'order':
      return `/admin/orders/${id}`;
    case 'product':
      return `/admin/products/${id}`;
    case 'product_variant':
      return `/admin/inventory/movements?variant=${id}`;
    case 'brand':
      return `/admin/catalog/brands/${id}`;
    case 'category':
      return `/admin/catalog/categories/${id}`;
    case 'collection':
      return `/admin/catalog/collections/${id}`;
    case 'fragrance_family':
      return `/admin/catalog/families/${id}`;
    case 'fragrance_note':
      return `/admin/catalog/notes/${id}`;
    case 'product_line':
      return '/admin/catalog/product-lines';
    case 'coupon':
      return `/admin/promotions/coupons/${id}`;
    case 'banner':
      return `/admin/content/banners/${id}`;
    case 'page':
      return `/admin/content/pages/${id}`;
    case 'post':
      return `/admin/content/posts/${id}`;
    case 'topic':
      return `/admin/content/topics/${id}`;
    case 'navigation_menu':
      return `/admin/content/navigation/${id}`;
    case 'redirect':
      return '/admin/content/redirects';
    case 'shipping_zone':
    case 'shipping_rate':
      return '/admin/shipping';
    case 'cod_remittance':
      return '/admin/payments/cod-remittances';
    case 'staff':
      return `/admin/staff/${id}`;
    case 'review':
      return '/admin/reviews?status=all';
    default:
      return null;
  }
}

/** Formula injection guard (CSV opened in Excel / Sheets) + RFC 4180 quoting. */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (Vietnamese names) correctly.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
