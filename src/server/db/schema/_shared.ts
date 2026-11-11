import { bigint, customType, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';

import { newId } from '@/server/lib/ids';

/** Supported content locales (ADR-0011). Keep in sync with `src/i18n/routing.ts`. */
export const localeEnum = pgEnum('locale', ['vi', 'en']);

/** Draft → active → archived lifecycle shared by catalogue entities. */
export const publicationStatusEnum = pgEnum('publication_status', ['draft', 'active', 'archived']);

/** Case-insensitive text (requires the `citext` extension, created in migration 0000). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** Full-text search vector, maintained by triggers (see migration 0002). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** UUIDv7 primary key generated in the application (ADR-0010). */
export const primaryId = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => newId());

/**
 * Money in VND (đồng). Stored as Postgres `bigint` (integer, never float); typed as an
 * integer `number` in TypeScript, which is exact up to 9×10^15 đồng.
 */
export const money = () => bigint({ mode: 'number' });

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
