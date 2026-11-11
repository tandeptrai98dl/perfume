import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client';

/** Applies pending migrations from src/server/db/migrations. Used by `pnpm db:migrate`. */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder: 'src/server/db/migrations' });
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
