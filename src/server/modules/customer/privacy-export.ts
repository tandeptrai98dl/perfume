import { asc, desc, eq, or } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  addresses,
  consents,
  newsletterSubscribers,
  privacyRequests,
  provinces,
  users,
  wards,
  wishlists,
} from '@/server/db/schema';
import { listOrdersForDataExport } from '@/server/modules/order';

import type { PrivacySubject } from './privacy-erasure';

/*
 * Personal-data export (right of access / data portability, PDPL 91/2025): one JSON document
 * with everything the shop holds about the subject. It is generated when downloaded (never
 * stored as a file), so no copy of the data sits in object storage.
 */

export const PERSONAL_DATA_EXPORT_FORMAT = 'perfume-store.personal-data.v1';

/** Extra sections contributed by other modules (e.g. reviews), keyed by section name. */
export type ExportSection = (
  db: Pick<Database, 'select'>,
  subject: PrivacySubject,
) => Promise<[name: string, data: unknown]>;

export type PersonalDataExport = {
  format: typeof PERSONAL_DATA_EXPORT_FORMAT;
  generatedAt: string;
  subject: { email: string };
  account: Record<string, unknown> | null;
  addresses: Record<string, unknown>[];
  orders: Awaited<ReturnType<typeof listOrdersForDataExport>>;
  consents: Record<string, unknown>[];
  newsletter: Record<string, unknown> | null;
  wishlist: Record<string, unknown>[];
  privacyRequests: Record<string, unknown>[];
  [section: string]: unknown;
};

export async function buildPersonalDataExport(
  db: Pick<Database, 'select'>,
  subject: PrivacySubject,
  options: { now?: Date; sections?: readonly ExportSection[] } = {},
): Promise<PersonalDataExport> {
  const { userId, email } = subject;
  const [account] = userId
    ? await db
        .select({
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          phone: users.phone,
          birthday: users.birthday,
          gender: users.gender,
          locale: users.locale,
          marketingOptIn: users.marketingOptIn,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    : [];

  const consentWhere = userId
    ? or(eq(consents.userId, userId), eq(consents.email, email))
    : eq(consents.email, email);
  const requestWhere = userId
    ? or(eq(privacyRequests.userId, userId), eq(privacyRequests.email, email))
    : eq(privacyRequests.email, email);

  const [addressRows, orders, consentRows, newsletter, wishlistRows, requests] = await Promise.all([
    userId
      ? db
          .select({
            fullName: addresses.fullName,
            phone: addresses.phone,
            street: addresses.street,
            ward: wards.name,
            province: provinces.name,
            legacyDistrict: addresses.legacyDistrict,
            isDefault: addresses.isDefault,
            createdAt: addresses.createdAt,
          })
          .from(addresses)
          .innerJoin(wards, eq(wards.code, addresses.wardCode))
          .innerJoin(provinces, eq(provinces.code, addresses.provinceCode))
          .where(eq(addresses.userId, userId))
          .orderBy(asc(addresses.createdAt))
      : Promise.resolve([]),
    listOrdersForDataExport(db, subject),
    db
      .select({
        purpose: consents.purpose,
        granted: consents.granted,
        policyVersion: consents.policyVersion,
        locale: consents.locale,
        source: consents.source,
        createdAt: consents.createdAt,
      })
      .from(consents)
      .where(consentWhere)
      .orderBy(asc(consents.createdAt)),
    db
      .select({
        email: newsletterSubscribers.email,
        locale: newsletterSubscribers.locale,
        status: newsletterSubscribers.status,
        source: newsletterSubscribers.source,
        createdAt: newsletterSubscribers.createdAt,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1),
    userId
      ? db
          .select({ productId: wishlists.productId, createdAt: wishlists.createdAt })
          .from(wishlists)
          .where(eq(wishlists.userId, userId))
      : Promise.resolve([]),
    db
      .select({
        type: privacyRequests.type,
        status: privacyRequests.status,
        createdAt: privacyRequests.createdAt,
        dueAt: privacyRequests.dueAt,
        completedAt: privacyRequests.completedAt,
      })
      .from(privacyRequests)
      .where(requestWhere)
      .orderBy(desc(privacyRequests.createdAt)),
  ]);

  const result: PersonalDataExport = {
    format: PERSONAL_DATA_EXPORT_FORMAT,
    generatedAt: (options.now ?? new Date()).toISOString(),
    subject: { email },
    account: account ?? null,
    addresses: addressRows,
    orders,
    consents: consentRows,
    newsletter: newsletter[0] ?? null,
    wishlist: wishlistRows,
    privacyRequests: requests,
  };
  for (const section of options.sections ?? []) {
    const [name, data] = await section(db, subject);
    if (!(name in result)) result[name] = data;
  }
  return result;
}
