import { uuidv7 } from 'uuidv7';

/** Time-ordered UUIDv7 for every primary key (ADR-0010). Never rely on DB-generated UUIDs. */
export function newId(): string {
  return uuidv7();
}
