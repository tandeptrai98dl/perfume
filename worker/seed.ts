/** Reference data for a fresh environment (administrative units, settings, default location):
 *    docker compose run --rm worker node dist/worker/seed.mjs
 *  The fictional demo catalogue is added only when SEED_DEMO=true.
 */
import { serverEnv } from '@/lib/env';
import { seed } from '@/server/db/seed';

seed(serverEnv().DATABASE_URL, { demo: process.env.SEED_DEMO === 'true' })
  .then((result) => console.log('Seed complete:', JSON.stringify(result)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
