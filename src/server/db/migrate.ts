import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client';

export const DEFAULT_MIGRATIONS_DIR = 'src/server/db/migrations';

/**
 * Applies pending migrations. Used by `pnpm db:migrate` and, in production, by the worker
 * image (`node dist/worker/migrate.mjs`, migrations copied to MIGRATIONS_DIR).
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR,
): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]?.endsWith('migrate.ts');
if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url)
    .then(() => console.log('Migrations applied.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
