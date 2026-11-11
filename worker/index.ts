/**
 * Background worker entry (pg-boss). Built with tsup into dist/worker (see tsup.config.ts)
 * and run with `node dist/worker/index.mjs` (`pnpm worker:start`). See ADR-0023.
 */
import { serverEnv } from '@/lib/env';
import { createEmailSender } from '@/server/integrations/email/send';
import { createHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues } from '@/server/jobs/queue';
import { registerWorkers } from '@/server/jobs/runner';
import { errorFields, logger } from '@/server/lib/logger';

async function main() {
  const env = serverEnv();
  const boss = createBoss(env.DATABASE_URL, { role: 'worker' });
  boss.on('error', (error) => logger.error('pgboss.error', errorFields(error)));

  const email = createEmailSender({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM });

  await boss.start();
  await ensureQueues(boss);
  await registerWorkers(
    boss,
    createHandlers({
      email,
      internalBaseUrl: env.INTERNAL_APP_URL ?? env.APP_URL,
      internalSecret: env.INTERNAL_API_SECRET,
    }),
  );
  logger.info('worker.started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('worker.stopping', { signal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    email.close();
    logger.info('worker.stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('worker.crashed', errorFields(error));
  process.exit(1);
});
