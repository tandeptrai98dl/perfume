import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { consents, orders, privacyRequests, users } from '@/server/db/schema';
import { listEntityAuditEntries } from '@/server/modules/audit';
import { codRiskForPhone } from '@/server/modules/order';
import { pageOffset, type Paged } from '@/server/lib/sql-helpers';

import { listAddresses, type SavedAddress } from './addresses';
import {
  COD_RISK_ACTION,
  CUSTOMER_NOTE_ACTION,
  NON_SPEND_STATUSES,
  type CustomerSort,
  type CustomerType,
} from './admin-constants';
import {
  customerKeyString,
  displayContact,
  parseCustomerSearch,
  prefixPattern,
  type CustomerKey,
} from './admin-rules';
import type { CustomerFilter, CustomerListQuery } from './admin-schemas';

/*
 * Admin read side of customers (§5.2 `/admin/customers`, §11.2): registered accounts and guest
 * contacts (guest orders grouped by phone, anonymised orders excluded), with order count,
 * lifetime spend (net of refunds, integer VND), last order, failed deliveries and the COD risk
 * flag (D16). Orders are read here, never written. Contact details leave this module masked
 * unless the caller says the role may see them (`canSeeCustomerContact`).
 */

type Reader = Pick<Database, 'select' | 'selectDistinctOn' | 'execute'>;

export type CustomerRow = {
  key: string;
  type: CustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  contactMasked: boolean;
  locale: 'vi' | 'en';
  orderCount: number;
  lifetimeSpend: number;
  lastOrderAt: Date | null;
  failedDeliveries: number;
  codRiskFlag: boolean;
  /** Account creation, or first guest order. */
  since: Date;
};

type RawRow = {
  kind: CustomerType;
  ref_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  locale: 'vi' | 'en';
  flagged: boolean;
  since: Date | string;
  order_count: number | string;
  spend: number | string;
  last_order_at: Date | string | null;
  failed: number | string;
};

const nonSpend = sql.join(
  NON_SPEND_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);
const spendOf = sql`coalesce(sum(o.total - o.amount_refunded) filter (where o.status::text not in (${nonSpend})), 0)`;
const failedOf = sql`count(*) filter (where exists (select 1 from order_events e where e.order_id = o.id and e.to_status = 'delivery_failed'))`;

/** Union of registered customers and guest contacts with their order aggregates. */
const customersCte = sql`
  user_orders as (
    select o.user_id, count(*) as order_count, ${spendOf} as spend,
           max(o.placed_at) as last_order_at, ${failedOf} as failed
    from orders o where o.user_id is not null group by o.user_id
  ),
  customers as (
    select 'registered'::text as kind, u.id::text as ref_id, u.name, u.phone, u.email::text as email,
           u.locale::text as locale, u.cod_risk_flag as flagged, u.created_at as since,
           coalesce(s.order_count, 0) as order_count, coalesce(s.spend, 0) as spend,
           s.last_order_at, coalesce(s.failed, 0) as failed
    from users u left join user_orders s on s.user_id = u.id
    where u.role = 'customer' and u.deleted_at is null
    union all
    select 'guest'::text, (array_agg(o.id order by o.placed_at desc, o.id desc))[1]::text,
           (array_agg(o.customer_name order by o.placed_at desc, o.id desc))[1], o.phone,
           (array_agg(nullif(o.email::text, '') order by o.placed_at desc, o.id desc))[1],
           (array_agg(o.locale::text order by o.placed_at desc, o.id desc))[1], false,
           min(o.placed_at), count(*), ${spendOf}, max(o.placed_at), ${failedOf}
    from orders o where o.user_id is null and o.phone <> '' group by o.phone
  )`;

function filterSql(filter: Pick<CustomerFilter, 'q' | 'type' | 'risk'>): SQL {
  const conditions: SQL[] = [sql`true`];
  if (filter.type) conditions.push(sql`c.kind = ${filter.type}`);
  if (filter.risk === 'flagged') conditions.push(sql`(c.flagged or c.failed > 0)`);
  const search = parseCustomerSearch(filter.q);
  if (search?.kind === 'email') {
    conditions.push(sql`lower(c.email) like ${prefixPattern(search.value)}`);
  } else if (search?.kind === 'phone') {
    conditions.push(sql`c.phone like ${prefixPattern(search.value)}`);
  } else if (search?.kind === 'name') {
    // Word prefix, accent- and case-insensitive.
    conditions.push(
      sql`immutable_unaccent(' ' || c.name) ilike immutable_unaccent(${`% ${prefixPattern(search.value)}`})`,
    );
  }
  return sql.join(conditions, sql` and `);
}

const SORT_COLUMNS: Record<CustomerSort, SQL> = {
  lastOrder: sql`c.last_order_at`,
  spend: sql`c.spend`,
  orders: sql`c.order_count`,
  name: sql`c.name`,
  since: sql`c.since`,
};

function orderSql(sort: CustomerSort, dir: 'asc' | 'desc'): SQL {
  const direction = dir === 'asc' ? sql`asc nulls first` : sql`desc nulls last`;
  return sql`${SORT_COLUMNS[sort]} ${direction}, c.kind, c.ref_id`;
}

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

function present(row: RawRow, contactVisible: boolean): CustomerRow {
  const contact = displayContact({ phone: row.phone, email: row.email }, contactVisible);
  const key: CustomerKey =
    row.kind === 'registered'
      ? { type: 'user', id: row.ref_id }
      : { type: 'guest', orderId: row.ref_id };
  return {
    key: customerKeyString(key),
    type: row.kind,
    name: row.name,
    phone: contact.phone,
    email: contact.email,
    contactMasked: contact.masked,
    locale: row.locale === 'en' ? 'en' : 'vi',
    orderCount: Number(row.order_count),
    lifetimeSpend: Number(row.spend),
    lastOrderAt: row.last_order_at ? toDate(row.last_order_at) : null,
    failedDeliveries: Number(row.failed),
    codRiskFlag: row.flagged,
    since: toDate(row.since),
  };
}

async function selectCustomers(
  db: Reader,
  filter: CustomerFilter,
  limit: number,
  offset: number,
): Promise<RawRow[]> {
  const result = await db.execute<RawRow>(sql`
    with ${customersCte}
    select * from customers c
    where ${filterSql(filter)}
    order by ${orderSql(filter.sort, filter.dir)}
    limit ${limit} offset ${offset}`);
  return result.rows;
}

export async function listCustomers(
  db: Reader,
  query: CustomerListQuery,
  options: { contactVisible: boolean },
): Promise<Paged<CustomerRow>> {
  const [rows, total] = await Promise.all([
    selectCustomers(db, query, query.pageSize, pageOffset(query.page, query.pageSize)),
    db.execute<{ n: number }>(sql`
      with ${customersCte}
      select count(*)::int as n from customers c where ${filterSql(query)}`),
  ]);
  return {
    rows: rows.map((row) => present(row, options.contactVisible)),
    total: total.rows[0]?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Rows of a CSV export: the filtered list, capped at `limit` (one more row = truncated). */
export async function listCustomersForExport(
  db: Reader,
  filter: CustomerFilter,
  options: { contactVisible: boolean; limit: number },
): Promise<{ rows: CustomerRow[]; truncated: boolean }> {
  const rows = await selectCustomers(db, filter, options.limit + 1, 0);
  return {
    rows: rows.slice(0, options.limit).map((row) => present(row, options.contactVisible)),
    truncated: rows.length > options.limit,
  };
}

/** Accounts carrying the COD risk flag (dashboard counter). */
export async function countFlaggedCustomers(db: Pick<Database, 'select'>): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'customer'), eq(users.codRiskFlag, true), isNull(users.deletedAt)));
  return row?.n ?? 0;
}

// ---------- Detail ----------

export type CustomerOrderRow = {
  id: string;
  code: string;
  placedAt: Date;
  status: (typeof orders.status.enumValues)[number];
  paymentStatus: (typeof orders.paymentStatus.enumValues)[number];
  paymentMethod: (typeof orders.paymentMethod.enumValues)[number];
  total: number;
  amountRefunded: number;
  failedDelivery: boolean;
};

export type CustomerConsent = {
  purpose: (typeof consents.purpose.enumValues)[number];
  granted: boolean;
  policyVersion: string;
  source: string;
  createdAt: Date;
};

export type CustomerHistoryEntry = {
  id: string;
  kind: 'note' | 'risk';
  actorName: string | null;
  /** Note text, or the reason given for the risk change. */
  text: string | null;
  /** Risk flag after the change (risk entries only). */
  flagged: boolean | null;
  createdAt: Date;
};

export type CustomerDetail = {
  key: string;
  type: CustomerType;
  /** Account id (registered customers only). */
  userId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  contactMasked: boolean;
  locale: 'vi' | 'en';
  since: Date;
  account: {
    emailVerified: boolean;
    lastLoginAt: Date | null;
    marketingOptIn: boolean;
    banned: boolean;
  } | null;
  codRiskFlag: boolean;
  stats: {
    orderCount: number;
    lifetimeSpend: number;
    lastOrderAt: Date | null;
    failedDeliveries: number;
  };
  /** Failed deliveries of every order sent to this phone, whoever placed it (D16). */
  phoneFailedDeliveries: number;
  addresses: SavedAddress[];
  orders: CustomerOrderRow[];
  consents: CustomerConsent[];
  history: CustomerHistoryEntry[];
  /** Data-subject requests filed with this customer's e-mail (or account). */
  privacyRequests: number;
};

export const CUSTOMER_ORDER_LIMIT = 100;

const failedDelivery = sql<boolean>`exists (select 1 from order_events e where e.order_id = ${orders.id} and e.to_status = 'delivery_failed')`;

async function customerOrders(db: Reader, where: SQL | undefined) {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      placedAt: orders.placedAt,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      amountRefunded: orders.amountRefunded,
      failedDelivery: failedDelivery.mapWith(Boolean),
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(CUSTOMER_ORDER_LIMIT);
  const [stats] = await db
    .select({
      orderCount: count(),
      spend: sql<string>`coalesce(sum(${orders.total} - ${orders.amountRefunded}) filter (where ${orders.status}::text not in (${nonSpend})), 0)`,
      lastOrderAt: sql<Date | string | null>`max(${orders.placedAt})`,
      failed: sql<string>`count(*) filter (where ${failedDelivery})`,
    })
    .from(orders)
    .where(where);
  return {
    rows,
    stats: {
      orderCount: stats?.orderCount ?? 0,
      lifetimeSpend: Number(stats?.spend ?? 0),
      lastOrderAt: stats?.lastOrderAt ? toDate(stats.lastOrderAt) : null,
      failedDeliveries: Number(stats?.failed ?? 0),
    },
  };
}

async function latestConsents(db: Reader, where: SQL | undefined): Promise<CustomerConsent[]> {
  return db
    .selectDistinctOn([consents.purpose], {
      purpose: consents.purpose,
      granted: consents.granted,
      policyVersion: consents.policyVersion,
      source: consents.source,
      createdAt: consents.createdAt,
    })
    .from(consents)
    .where(where)
    .orderBy(consents.purpose, desc(consents.createdAt), desc(consents.id));
}

async function customerHistory(db: Reader, userId: string): Promise<CustomerHistoryEntry[]> {
  const entries = await listEntityAuditEntries(db, {
    entityType: 'user',
    entityId: userId,
    actions: [CUSTOMER_NOTE_ACTION, COD_RISK_ACTION],
    limit: 50,
  });
  return entries.map((entry) => {
    const diff = entry.diff ?? {};
    const to = (field: string) => {
      const change = diff[field];
      return change && typeof change === 'object' && 'to' in change
        ? (change as { to: unknown }).to
        : undefined;
    };
    if (entry.action === CUSTOMER_NOTE_ACTION) {
      const note = to('note');
      return {
        id: entry.id,
        kind: 'note' as const,
        actorName: entry.actorName,
        text: typeof note === 'string' ? note : null,
        flagged: null,
        createdAt: entry.createdAt,
      };
    }
    const reason = to('reason');
    const flag = to('codRiskFlag');
    return {
      id: entry.id,
      kind: 'risk' as const,
      actorName: entry.actorName,
      // Flags set by a failed delivery (order module) carry the order instead of a reason.
      text: typeof reason === 'string' ? reason : null,
      flagged: typeof flag === 'boolean' ? flag : null,
      createdAt: entry.createdAt,
    };
  });
}

async function countPrivacyRequests(db: Reader, where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ n: count() }).from(privacyRequests).where(where);
  return row?.n ?? 0;
}

export async function getCustomerDetail(
  db: Reader,
  key: CustomerKey,
  options: { contactVisible: boolean },
): Promise<CustomerDetail | null> {
  if (key.type === 'user') {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, key.id), eq(users.role, 'customer'), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return null;
    const contact = displayContact(
      { phone: user.phone, email: user.email },
      options.contactVisible,
    );
    const [orderData, addressList, consentList, history, privacy, phoneRisk] = await Promise.all([
      customerOrders(db, eq(orders.userId, user.id)),
      listAddresses(db, user.id),
      latestConsents(db, eq(consents.userId, user.id)),
      customerHistory(db, user.id),
      countPrivacyRequests(
        db,
        or(eq(privacyRequests.userId, user.id), eq(privacyRequests.email, user.email)),
      ),
      user.phone ? codRiskForPhone(db, user.phone) : null,
    ]);
    return {
      key: customerKeyString(key),
      type: 'registered',
      userId: user.id,
      name: user.name,
      phone: contact.phone,
      email: contact.email,
      contactMasked: contact.masked,
      locale: user.locale,
      since: user.createdAt,
      account: {
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt,
        marketingOptIn: user.marketingOptIn,
        banned: user.banned,
      },
      codRiskFlag: user.codRiskFlag,
      stats: orderData.stats,
      phoneFailedDeliveries: phoneRisk?.failedDeliveries ?? 0,
      addresses: options.contactVisible
        ? addressList
        : addressList.map((address) => ({
            ...address,
            phone: displayContact({ phone: address.phone, email: null }, false).phone ?? '',
          })),
      orders: orderData.rows,
      consents: consentList,
      history,
      privacyRequests: privacy,
    };
  }

  // Guest contact: every guest order with the phone of the referenced guest order.
  const [anchor] = await db
    .select({ phone: orders.phone })
    .from(orders)
    .where(and(eq(orders.id, key.orderId), isNull(orders.userId)))
    .limit(1);
  if (!anchor || !anchor.phone) return null;
  const guestOrders = and(isNull(orders.userId), eq(orders.phone, anchor.phone));
  const [latest] = await db
    .select({
      name: orders.customerName,
      email: orders.email,
      locale: orders.locale,
    })
    .from(orders)
    .where(guestOrders)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(1);
  const emails = (
    await db
      .selectDistinctOn([orders.email], { email: orders.email })
      .from(orders)
      .where(guestOrders)
  )
    .map((row) => row.email)
    .filter(Boolean);
  const [orderData, consentList, privacy, phoneRisk] = await Promise.all([
    customerOrders(db, guestOrders),
    latestConsents(
      db,
      and(
        isNull(consents.userId),
        or(
          eq(consents.phone, anchor.phone),
          emails.length > 0 ? inArray(consents.email, emails) : undefined,
        ),
      ),
    ),
    emails.length > 0
      ? countPrivacyRequests(db, inArray(privacyRequests.email, emails))
      : Promise.resolve(0),
    codRiskForPhone(db, anchor.phone),
  ]);
  const since = await db
    .select({ first: sql<Date | string>`min(${orders.placedAt})` })
    .from(orders)
    .where(guestOrders);
  const contact = displayContact(
    { phone: anchor.phone, email: latest?.email ?? null },
    options.contactVisible,
  );
  return {
    key: customerKeyString(key),
    type: 'guest',
    userId: null,
    name: latest?.name ?? '',
    phone: contact.phone,
    email: contact.email,
    contactMasked: contact.masked,
    locale: latest?.locale ?? 'vi',
    since: since[0]?.first ? toDate(since[0].first) : new Date(),
    account: null,
    codRiskFlag: false,
    stats: orderData.stats,
    phoneFailedDeliveries: phoneRisk.failedDeliveries,
    addresses: [],
    orders: orderData.rows,
    consents: consentList,
    history: [],
    privacyRequests: privacy,
  };
}

/** Customer e-mail for the privacy-requests link (full address: the link is Owner-only). */
export async function customerPrivacyEmail(
  db: Pick<Database, 'select'>,
  key: CustomerKey,
): Promise<string | null> {
  if (key.type === 'user') {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, key.id));
    return row?.email ?? null;
  }
  const [row] = await db
    .select({ email: orders.email })
    .from(orders)
    .where(and(eq(orders.id, key.orderId), isNull(orders.userId)));
  return row?.email || null;
}
