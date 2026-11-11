import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** Escapes LIKE wildcards in user input and wraps it for a "contains" match. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Accent- and case-insensitive "contains" (uses the immutable_unaccent wrapper, §6.1). */
export function foldedContains(column: AnyColumn | SQL, query: string): SQL {
  return sql`immutable_unaccent(${column}) ilike immutable_unaccent(${containsPattern(query)})`;
}

export function pageOffset(page: number, pageSize: number): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number };
