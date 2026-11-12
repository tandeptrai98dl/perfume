import { normalizeVietnamesePhone } from '@/lib/phone';
import { hasPermission } from '@/server/auth/permissions';
import { partialEmail, partialPhone } from '@/server/modules/order';

import { NON_SPEND_STATUSES } from './admin-constants';

/*
 * Pure rules of the admin customer screens (§5.2 `/admin/customers`, §11.2 "Customers").
 * No I/O; unit-tested.
 */

export {
  COD_RISK_ACTION,
  COD_RISK_REASON_MAX,
  COD_RISK_REASON_MIN,
  CUSTOMER_EXPORT_LIMIT,
  CUSTOMER_NOTE_ACTION,
  CUSTOMER_NOTE_MAX,
  CUSTOMER_SORTS,
  CUSTOMER_TYPES,
  NON_SPEND_STATUSES,
  type CustomerSort,
  type CustomerType,
} from './admin-constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_PREFIX = 'g-';

/**
 * Route key of a customer: the account id, or `g-<order id>` for a guest contact (any guest
 * order of that phone; the page groups every guest order with the same phone).
 */
export type CustomerKey = { type: 'user'; id: string } | { type: 'guest'; orderId: string };

export function parseCustomerKey(value: string): CustomerKey | null {
  if (UUID.test(value)) return { type: 'user', id: value.toLowerCase() };
  if (value.startsWith(GUEST_PREFIX) && UUID.test(value.slice(GUEST_PREFIX.length))) {
    return { type: 'guest', orderId: value.slice(GUEST_PREFIX.length).toLowerCase() };
  }
  return null;
}

export function customerKeyString(key: CustomerKey): string {
  return key.type === 'user' ? key.id : `${GUEST_PREFIX}${key.orderId}`;
}

export type CustomerSearch =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'name'; value: string };

/**
 * Search box → exact-or-prefix match (§11.2): an e-mail (contains `@`) or the start of one,
 * a phone number or its first digits (any of `+84 912 …`, `0912.345…`), else a name word
 * prefix ("Hươ" finds "Nguyễn Thị Hương"), accent-insensitive.
 */
export function parseCustomerSearch(raw: string): CustomerSearch | null {
  const q = raw.trim().slice(0, 100);
  if (!q) return null;
  if (q.includes('@')) return { kind: 'email', value: q.toLowerCase() };
  if (/^\+?[\d\s.\-()]+$/.test(q) && q.replace(/\D/g, '').length >= 3) {
    const national = normalizeVietnamesePhone(q).replace(/^(?:\+84|0084)/, '0');
    return { kind: 'phone', value: national.replace(/\D/g, '') };
  }
  return { kind: 'name', value: q };
}

/** Escapes LIKE wildcards in user input for a prefix pattern. */
export function prefixPattern(value: string): string {
  return `${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * RBAC §11.1 "Customer contact details": phone and e-mail are shown in full only to roles
 * with `customers.viewContactInOrder`; anyone else sees them partially masked.
 */
export function canSeeCustomerContact(role: string): boolean {
  return hasPermission(role, 'customers.viewContactInOrder');
}

export function displayContact(
  contact: { phone: string | null; email: string | null },
  visible: boolean,
): { phone: string | null; email: string | null; masked: boolean } {
  const phone = contact.phone || null;
  const email = contact.email || null;
  if (visible) return { phone, email, masked: false };
  return {
    phone: phone ? partialPhone(phone) : null,
    email: email ? partialEmail(email) : null,
    masked: true,
  };
}

/** Lifetime spend of a set of orders (same rule as the SQL aggregate). */
export function lifetimeSpend(
  rows: readonly { status: string; total: number; amountRefunded: number }[],
): number {
  return rows
    .filter((row) => !(NON_SPEND_STATUSES as readonly string[]).includes(row.status))
    .reduce((sum, row) => sum + row.total - row.amountRefunded, 0);
}
