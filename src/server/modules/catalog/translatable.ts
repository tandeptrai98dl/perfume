import { and, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Locale } from '@/i18n/routing';
import { diffRecords, prefixDiff, type AuditDiff } from '@/server/lib/audit';
import {
  DomainError,
  isUniqueViolation,
  type FieldIssue,
  type Tx,
} from '@/server/lib/command-context';

import { LOCALES } from './admin-schemas';

/**
 * Shared handling of `<entity>_translations` tables keyed by (entity_id, locale) with a
 * unique (locale, slug) (ARCHITECTURE.md §6.1). Vietnamese is always written; English is
 * upserted when present and deleted when the editor removes it.
 */

export type TranslationTable = {
  table: PgTable;
  /** Property name of the foreign key in the Drizzle table, e.g. `brandId`. */
  fkKey: string;
  fk: PgColumn;
  locale: PgColumn;
  slug: PgColumn;
};

export type TranslationValues = Record<string, unknown> & { slug: string };
export type TranslationSet<T extends TranslationValues = TranslationValues> = {
  vi: T;
  en: T | null;
};
export type StoredTranslations = Partial<Record<Locale, Record<string, unknown>>>;

/** Columns the editor never writes (keys, timestamps, trigger-maintained values). */
const SYSTEM_COLUMNS = new Set(['locale', 'createdAt', 'updatedAt', 'searchVector']);

export async function readTranslations(
  tx: Pick<Tx, 'select'>,
  spec: TranslationTable,
  entityId: string,
): Promise<StoredTranslations> {
  const rows = (await tx
    .select()
    .from(spec.table as never)
    .where(eq(spec.fk, entityId))) as Record<string, unknown>[];
  const result: StoredTranslations = {};
  for (const row of rows) {
    const locale = row.locale as Locale;
    result[locale] = Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== spec.fkKey && !SYSTEM_COLUMNS.has(key)),
    );
  }
  return result;
}

/** Fails with `slugTaken` issues when another entity already uses a slug in that locale. */
export async function assertSlugsAvailable(
  tx: Pick<Tx, 'select'>,
  spec: TranslationTable,
  entityId: string | null,
  translations: TranslationSet,
): Promise<void> {
  const issues: FieldIssue[] = [];
  for (const locale of LOCALES) {
    const value = translations[locale];
    if (!value) continue;
    const conditions: SQL[] = [eq(spec.locale, locale), eq(spec.slug, value.slug)];
    if (entityId) conditions.push(ne(spec.fk, entityId));
    const clash = await tx
      .select({ id: spec.fk })
      .from(spec.table as never)
      .where(and(...conditions))
      .limit(1);
    if (clash.length > 0) issues.push({ path: `translations.${locale}.slug`, code: 'slugTaken' });
  }
  if (issues.length > 0) throw new DomainError('slugTaken', issues);
}

export async function writeTranslations(
  tx: Tx,
  spec: TranslationTable,
  entityId: string,
  translations: TranslationSet,
): Promise<void> {
  try {
    for (const locale of LOCALES) {
      const values = translations[locale];
      if (!values) {
        await tx
          .delete(spec.table as never)
          .where(and(eq(spec.fk, entityId), eq(spec.locale, locale)));
        continue;
      }
      await tx
        .insert(spec.table as never)
        .values({ ...values, [spec.fkKey]: entityId, locale } as never)
        .onConflictDoUpdate({
          target: [spec.fk, spec.locale],
          set: { ...values, updatedAt: new Date() } as never,
        });
    }
  } catch (error) {
    // Lost a race with another save using the same slug.
    if (isUniqueViolation(error)) throw new DomainError('slugTaken');
    throw error;
  }
}

/** Audit diff of translation rows, keyed `<locale>.<field>`. */
export function diffTranslations(before: StoredTranslations, after: TranslationSet): AuditDiff {
  let diff: AuditDiff = {};
  for (const locale of LOCALES) {
    const next = after[locale] ? { ...after[locale] } : null;
    const previous = before[locale] ?? null;
    diff = { ...diff, ...prefixDiff(`${locale}.`, diffRecords(previous, next)) };
  }
  return diff;
}

/** Slug + publish state per locale, for slug-change detection. */
export function slugStates(translations: StoredTranslations | TranslationSet) {
  const result: Partial<Record<Locale, { slug: string; isPublished?: boolean }>> = {};
  for (const locale of LOCALES) {
    const value = translations[locale] as Record<string, unknown> | null | undefined;
    if (!value) continue;
    result[locale] = {
      slug: String(value.slug),
      ...(typeof value.isPublished === 'boolean' ? { isPublished: value.isPublished } : {}),
    };
  }
  return result;
}

/** Ids from `ids` that exist in `column` (used to validate foreign keys before writing). */
export async function existingIds(
  tx: Pick<Tx, 'select'>,
  table: PgTable,
  column: PgColumn,
  ids: readonly string[],
  extra?: SQL,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = (await tx
    .select({ id: column })
    .from(table as never)
    .where(and(inArray(column, [...ids]), extra))) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}
