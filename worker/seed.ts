/** Base data for a fresh environment (administrative units, settings defaults, default
 *  location, policy pages + legal menu, shipping rates), see docs/ops/seed.md:
 *    docker compose run --rm worker node dist/worker/seed.mjs
 *  The fictional demo data is added only when SEED_DEMO=true.
 */
import { serverEnv } from '@/lib/env';
import { seed } from '@/server/db/seed';

seed(serverEnv().DATABASE_URL, { demo: process.env.SEED_DEMO === 'true' })
  .then((result) => console.log('Seed complete:', JSON.stringify(result)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
