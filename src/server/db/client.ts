import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { serverEnv } from '@/lib/env';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Database | undefined;

/** Shared pg pool (also used by pg-boss in the worker). Created lazily on first use. */
export function getPool(): Pool {
  pool ??= new Pool({ connectionString: serverEnv().DATABASE_URL, max: 10 });
  return pool;
}

/** Drizzle client with snake_case column mapping. */
export function getDb(): Database {
  db ??= drizzle(getPool(), { schema, casing: 'snake_case' });
  return db;
}

/** Test/dev helper: build a client for an explicit connection string. */
export function createDb(connectionString: string): { db: Database; pool: Pool } {
  const p = new Pool({ connectionString, max: 5 });
  return { db: drizzle(p, { schema, casing: 'snake_case' }), pool: p };
}
