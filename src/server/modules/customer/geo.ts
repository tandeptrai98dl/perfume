import { asc, eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { provinces, wards } from '@/server/db/schema';

/**
 * Two-level administrative units (province → ward, §10.4). English forms show names without
 * diacritics (§10.7). Read-only: the seed owns the data.
 */

type Reader = Pick<Database, 'select'>;
export type AdminUnit = { code: string; name: string; nameAscii: string };

export async function listProvinces(db: Reader): Promise<AdminUnit[]> {
  return db
    .select({ code: provinces.code, name: provinces.name, nameAscii: provinces.nameAscii })
    .from(provinces)
    .orderBy(asc(provinces.name));
}

export async function listWards(db: Reader, provinceCode: string): Promise<AdminUnit[]> {
  return db
    .select({ code: wards.code, name: wards.name, nameAscii: wards.nameAscii })
    .from(wards)
    .where(eq(wards.provinceCode, provinceCode))
    .orderBy(asc(wards.name));
}

/** Display name of a unit in the active locale. */
export function unitName(unit: Pick<AdminUnit, 'name' | 'nameAscii'>, locale: 'vi' | 'en'): string {
  return locale === 'en' ? unit.nameAscii : unit.name;
}
