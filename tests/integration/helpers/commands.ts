import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import { locations, users } from '@/server/db/schema';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';

import { startTestDatabase, type TestDatabase } from './database';

/** Migrated test DB + pg-boss producer + one staff user per role, for command tests. */
export type CommandHarness = {
  db: Database;
  boss: PgBoss;
  url: string;
  ctx: (role: StaffRole) => CommandContext;
  actorIds: Record<StaffRole, string>;
  jobs: (name: string) => Promise<{ data: { tags: string[] } }[]>;
  stop: () => Promise<void>;
};

export async function startCommandHarness(): Promise<CommandHarness> {
  const testDb: TestDatabase = await startTestDatabase();
  const { db, pool } = createDb(testDb.url);
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  const boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);

  await db.insert(locations).values({ name: 'Main warehouse', isDefault: true });
  const roles: StaffRole[] = ['owner', 'manager', 'staff', 'editor'];
  const actorIds = {} as Record<StaffRole, string>;
  for (const role of roles) {
    const id = newId();
    actorIds[role] = id;
    await db.insert(users).values({ id, name: role, email: `${role}@example.com`, role });
  }

  return {
    db,
    boss,
    url: testDb.url,
    actorIds,
    ctx: (role) => ({ db, boss, actor: { id: actorIds[role], role }, ip: '127.0.0.1' }),
    jobs: async (name) => {
      const result = await db.execute<{ data: { tags: string[] } }>(
        sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on`,
      );
      return result.rows;
    },
    stop: async () => {
      await boss.stop({ graceful: false });
      await pool.end();
      await testDb.stop();
    },
  };
}
