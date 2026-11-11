/**
 * Outbox smoke test: writes an audit row and enqueues `system.test-email` in ONE transaction.
 * The running worker (`pnpm worker:dev`) picks it up and sends it (Mailpit: http://localhost:8025).
 *
 *   pnpm jobs:test-email --to you@example.com [--locale en]
 */
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { createDb } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import { createBoss, ensureQueues, enqueue } from '@/server/jobs/queue';
import { maskEmail } from '@/server/lib/mask';

const args = z
  .object({ to: z.email(), locale: z.enum(['vi', 'en']).default('vi') })
  .parse(parseArgs({ options: { to: { type: 'string' }, locale: { type: 'string' } } }).values);

async function main() {
  const env = serverEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  const boss = createBoss(env.DATABASE_URL, { role: 'producer' });

  try {
    await boss.start();
    await ensureQueues(boss);
    const jobId = await db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({
        action: 'system.test_email_requested',
        entityType: 'system',
        diff: { to: maskEmail(args.to), locale: args.locale },
      });
      return enqueue(boss, tx, 'system.test-email', args);
    });
    console.log(`Enqueued system.test-email job ${jobId} for ${maskEmail(args.to)}`);
  } finally {
    await boss.stop({ graceful: false });
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
