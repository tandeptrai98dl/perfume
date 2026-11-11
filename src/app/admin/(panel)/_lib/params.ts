const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids are UUIDs; anything else is a 404 before touching the database. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
