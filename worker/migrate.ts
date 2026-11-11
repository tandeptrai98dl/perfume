/** Production migrations, run from the worker image before a deploy switches traffic:
 *    docker compose run --rm worker node dist/worker/migrate.mjs
 */
import { serverEnv } from '@/lib/env';
import { runMigrations } from '@/server/db/migrate';

runMigrations(serverEnv().DATABASE_URL)
  .then(() => console.log('Migrations applied.'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
