import { getDb } from '@/server/db/client';
import {
  catalogRouteData,
  loadCatalogRouteEntities,
  loadCatalogRouteVersion,
} from '@/server/modules/catalog';
import { errorFields, logger } from '@/server/lib/logger';
import {
  createRouteTableCache,
  loadRouteTableData,
  loadRouteTableVersion,
  recordRedirectHits,
  type RouteTableSnapshot,
} from '@/server/modules/content';

/**
 * Process-wide route table for `src/proxy.ts` (redirects + which content and catalogue URLs
 * exist) and the redirect hit counter, flushed in batches so a redirect never costs a write
 * per request. Catalogue saves are picked up by the version check (at most every 5 s).
 */

async function loadVersion(): Promise<string> {
  const db = getDb();
  const [content, catalog] = await Promise.all([
    loadRouteTableVersion(db),
    loadCatalogRouteVersion(db),
  ]);
  return `${content}|${catalog}`;
}

const cache = createRouteTableCache({
  load: async () => {
    const db = getDb();
    const [version, data, catalogEntities] = await Promise.all([
      loadVersion(),
      loadRouteTableData(db),
      loadCatalogRouteEntities(db),
    ]);
    const catalog = catalogRouteData(catalogEntities);
    return {
      version,
      data: {
        redirects: data.redirects,
        contentPaths: [...data.contentPaths, ...catalog.contentPaths],
        localeFallbacks: [...data.localeFallbacks, ...catalog.localeFallbacks],
      },
    };
  },
  loadVersion,
  onError: (error) => logger.warn('routeTable.load.failed', errorFields(error)),
});

export function getRouteTable(): Promise<RouteTableSnapshot | null> {
  return cache.get();
}

const FLUSH_INTERVAL_MS = 30_000;
let pendingHits = new Map<string, number>();
let lastFlush = Date.now();

/** Counts a redirect hit; flushes accumulated counts at most every 30 s. */
export function countRedirectHit(path: string): void {
  pendingHits.set(path, (pendingHits.get(path) ?? 0) + 1);
  if (Date.now() - lastFlush < FLUSH_INTERVAL_MS) return;
  lastFlush = Date.now();
  const batch = pendingHits;
  pendingHits = new Map();
  recordRedirectHits(getDb(), batch).catch((error: unknown) =>
    logger.warn('redirects.hits.flushFailed', errorFields(error)),
  );
}
