import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { addresses, provinces, wards } from '@/server/db/schema';

import type { SavedAddress } from './addresses';
import type { AdminUnit } from './geo';

/*
 * Read-only queries for the two-level administrative units (province → ward, 2025 reform) and
 * members' saved addresses, used by checkout. Address CRUD belongs to the account stream.
 * Names are returned with and without diacritics: English UIs show `nameAscii` (§10.7) while
 * search accepts both forms.
 */

type Executor = Pick<Database, 'select'>;

export type WardUnit = AdminUnit & { provinceCode: string };

/** A ward with its province, when both exist and belong together; otherwise a reason. */
export async function resolveWard(
  db: Executor,
  input: { provinceCode: string; wardCode: string },
): Promise<
  | { ok: true; province: AdminUnit; ward: WardUnit }
  | { ok: false; field: 'provinceCode' | 'wardCode'; code: 'provinceUnknown' | 'wardMismatch' }
> {
  const [province] = await db
    .select({ code: provinces.code, name: provinces.name, nameAscii: provinces.nameAscii })
    .from(provinces)
    .where(eq(provinces.code, input.provinceCode))
    .limit(1);
  if (!province) return { ok: false, field: 'provinceCode', code: 'provinceUnknown' };
  const [ward] = await db
    .select({
      code: wards.code,
      name: wards.name,
      nameAscii: wards.nameAscii,
      provinceCode: wards.provinceCode,
    })
    .from(wards)
    .where(and(eq(wards.code, input.wardCode), eq(wards.provinceCode, input.provinceCode)))
    .limit(1);
  if (!ward) return { ok: false, field: 'wardCode', code: 'wardMismatch' };
  return { ok: true, province, ward };
}

/** A member's address book, default first (§10.6, max 10 enforced by the account stream). */
export async function listSavedAddresses(db: Executor, userId: string): Promise<SavedAddress[]> {
  return db
    .select({
      id: addresses.id,
      fullName: addresses.fullName,
      phone: addresses.phone,
      provinceCode: addresses.provinceCode,
      provinceName: provinces.name,
      provinceNameAscii: provinces.nameAscii,
      wardCode: addresses.wardCode,
      wardName: wards.name,
      wardNameAscii: wards.nameAscii,
      street: addresses.street,
      isDefault: addresses.isDefault,
    })
    .from(addresses)
    .innerJoin(provinces, eq(provinces.code, addresses.provinceCode))
    .innerJoin(wards, eq(wards.code, addresses.wardCode))
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.updatedAt))
    .limit(10);
}
