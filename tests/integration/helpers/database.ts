import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { runMigrations } from '@/server/db/migrate';

export type TestDatabase = { url: string; stop: () => Promise<void> };

async function resetSchema(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

/** Fresh, fully migrated database for a test file. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;
  let container: StartedPostgreSqlContainer | undefined;
  let url: string;

  if (external) {
    url = external;
    await resetSchema(url);
  } else {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    url = container.getConnectionUri();
  }

  await runMigrations(url);
  return {
    url,
    stop: async () => {
      await container?.stop();
    },
  };
}
