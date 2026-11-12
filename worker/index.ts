/**
 * Background worker entry (pg-boss). Built with tsup into dist/worker (see tsup.config.ts)
 * and run with `node dist/worker/index.mjs` (`pnpm worker:start`). See ADR-0023.
 */
import * as Sentry from '@sentry/node';

import { serverEnv } from '@/lib/env';
import { sentryOptions } from '@/lib/observability/sentry-options';
import { createEinvoiceProvider } from '@/server/integrations/einvoice';
import { createEmailSender } from '@/server/integrations/email/send';
import { createHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, scheduleCronJobs } from '@/server/jobs/queue';
import { createDb } from '@/server/db/client';
import { registerWorkers } from '@/server/jobs/runner';
import { errorFields, logger } from '@/server/lib/logger';

async function main() {
  const env = serverEnv();
  if (env.SENTRY_DSN) {
    Sentry.init(
      sentryOptions({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: 0,
      }),
    );
  }
  const boss = createBoss(env.DATABASE_URL, { role: 'worker' });
  boss.on('error', (error) => logger.error('pgboss.error', errorFields(error)));

  const email = createEmailSender({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM });
  const { db, pool } = createDb(env.DATABASE_URL);

  await boss.start();
  await ensureQueues(boss);
  await scheduleCronJobs(boss);
  await registerWorkers(
    boss,
    createHandlers({
      db,
      boss,
      email,
      appUrl: env.APP_URL,
      internalBaseUrl: env.INTERNAL_APP_URL ?? env.APP_URL,
      internalSecret: env.INTERNAL_API_SECRET,
      orderLinkSecret: env.BETTER_AUTH_SECRET,
      staffAlertEmail: env.STAFF_ALERT_EMAIL,
      telegramBotToken: env.TELEGRAM_BOT_TOKEN,
      telegramChatId: env.TELEGRAM_CHAT_ID,
      einvoice: createEinvoiceProvider(env),
    }),
    (error, context) => Sentry.captureException(error, { tags: context }),
  );
  logger.info('worker.started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('worker.stopping', { signal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    email.close();
    await pool.end();
    await Sentry.flush(2_000);
    logger.info('worker.stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (error: unknown) => {
  logger.error('worker.crashed', errorFields(error));
  Sentry.captureException(error);
  await Sentry.flush(2_000);
  process.exit(1);
});
