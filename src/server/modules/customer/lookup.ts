import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orders, users } from '@/server/db/schema';
import { codRiskForPhone, partialEmail, partialPhone } from '@/server/modules/order';

/*
 * Customer lookup for manual orders (§11.2 "find customer by phone/email or create"). Exact
 * matches only (normalized phone, case-insensitive e-mail), so staff cannot browse customers
 * (Staff has no /admin/customers access, §11.1). Contact details leave this module masked:
 * the order command resolves the full phone/e-mail from the chosen reference on the server.
 * Read-only; orders are read, never written, here.
 */

type Reader = Pick<Database, 'select' | 'selectDistinctOn'>;

export type CustomerRef = { type: 'user' | 'order'; id: string };

export type CustomerMatch = {
  ref: CustomerRef;
  /** True for a registered account (the order is linked to it). */
  registered: boolean;
  name: string;
  phoneMasked: string | null;
  emailMasked: string | null;
  locale: 'vi' | 'en';
  orderCount: number;
  /** Failed COD deliveries on this phone, or an account flagged after one (D16). */
  codRisk: boolean;
};

export type ResolvedCustomer = {
  userId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  locale: 'vi' | 'en';
};

const MAX_GUEST_MATCHES = 3;

function masked(value: string | null | undefined, mask: (v: string) => string): string | null {
  return value ? mask(value) : null;
}

/**
 * Registered customers and earlier guest-order contacts with this phone or e-mail. Guest
 * contacts are grouped by (phone, e-mail), latest order first.
 */
export async function lookupCustomers(
  db: Reader,
  query: { phone?: string | null; email?: string | null },
): Promise<CustomerMatch[]> {
  const phone = query.phone?.trim() || null;
  const email = query.email?.trim().toLowerCase() || null;
  if (!phone && !email) return [];

  const userMatch = or(
    phone ? eq(users.phone, phone) : undefined,
    email ? eq(users.email, email) : undefined,
  );
  const accounts = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      locale: users.locale,
      codRiskFlag: users.codRiskFlag,
      orderCount: sql<number>`(select count(*)::int from ${orders} o where o.user_id = ${users.id})`,
    })
    .from(users)
    .where(and(userMatch, eq(users.role, 'customer'), isNull(users.deletedAt)))
    .orderBy(desc(users.createdAt))
    .limit(MAX_GUEST_MATCHES);

  const orderMatch = or(
    phone ? eq(orders.phone, phone) : undefined,
    email ? eq(orders.email, email) : undefined,
  );
  const guests = await db
    .selectDistinctOn([orders.phone, orders.email], {
      id: orders.id,
      name: orders.customerName,
      phone: orders.phone,
      email: orders.email,
      locale: orders.locale,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(and(orderMatch, isNull(orders.userId)))
    .orderBy(orders.phone, orders.email, desc(orders.placedAt))
    .limit(MAX_GUEST_MATCHES);

  const guestCounts = new Map<string, number>();
  for (const guest of guests) {
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(
        and(isNull(orders.userId), eq(orders.phone, guest.phone), eq(orders.email, guest.email)),
      );
    guestCounts.set(guest.id, row?.n ?? 0);
  }

  const risk = phone ? await codRiskForPhone(db, phone) : null;
  const phoneRisk = !!risk && (risk.accountFlagged || risk.failedDeliveries > 0);

  const matches: CustomerMatch[] = accounts.map((account) => ({
    ref: { type: 'user', id: account.id },
    registered: true,
    name: account.name,
    phoneMasked: masked(account.phone, partialPhone),
    emailMasked: masked(account.email, partialEmail),
    locale: account.locale,
    orderCount: account.orderCount,
    codRisk: account.codRiskFlag || (phoneRisk && account.phone === phone),
  }));
  for (const guest of guests.sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())) {
    matches.push({
      ref: { type: 'order', id: guest.id },
      registered: false,
      name: guest.name,
      phoneMasked: masked(guest.phone, partialPhone),
      emailMasked: masked(guest.email, partialEmail),
      locale: guest.locale,
      orderCount: guestCounts.get(guest.id) ?? 0,
      codRisk: phoneRisk && guest.phone === phone,
    });
  }
  return matches;
}

/**
 * Full contact details behind a lookup reference (server side only). A user reference must be
 * a live customer account; an order reference must be a guest order. Null when invalid.
 */
export async function resolveCustomerRef(
  db: Pick<Database, 'select'>,
  ref: CustomerRef,
): Promise<ResolvedCustomer | null> {
  if (ref.type === 'user') {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        locale: users.locale,
      })
      .from(users)
      .where(and(eq(users.id, ref.id), eq(users.role, 'customer'), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return null;
    return {
      userId: user.id,
      name: user.name,
      phone: user.phone || null,
      email: user.email,
      locale: user.locale,
    };
  }
  const [order] = await db
    .select({
      name: orders.customerName,
      phone: orders.phone,
      email: orders.email,
      locale: orders.locale,
    })
    .from(orders)
    .where(and(eq(orders.id, ref.id), isNull(orders.userId)))
    .limit(1);
  if (!order) return null;
  return {
    userId: null,
    name: order.name,
    phone: order.phone || null,
    email: order.email || null,
    locale: order.locale,
  };
}
