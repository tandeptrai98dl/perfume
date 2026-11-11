import { normalizePath } from './redirects';
import type { RedirectStatusCode } from './types';

/**
 * In-memory routing snapshot used by `src/proxy.ts` (redirects + which content URLs exist),
 * so the proxy never queries the database per request:
 *
 * - the first request loads the snapshot (blocking);
 * - afterwards a cheap version query runs at most every `checkIntervalMs`, in the background,
 *   and the snapshot is reloaded only when the version changed;
 * - writes in this process call `invalidateRouteTable()` (also triggered by the
 *   `content:redirects` cache tag from the worker), and the next request reloads.
 *
 * The invalidation epoch lives on `globalThis` because the proxy and the app routes are
 * separate bundles that share one Node.js process when self-hosted.
 */

export type RouteTableData = {
  redirects: { fromPath: string; toPath: string; statusCode: RedirectStatusCode }[];
  /** Published content URLs; `visibleFrom` (ms) delays scheduled posts. */
  contentPaths: { path: string; visibleFrom: number | null }[];
  /** URLs produced by the language switcher for another locale's slug → equivalent page. */
  localeFallbacks: { path: string; toPath: string }[];
};

export type RouteTableSnapshot = {
  version: string;
  redirects: Map<string, { toPath: string; statusCode: RedirectStatusCode }>;
  contentPaths: Map<string, number | null>;
  localeFallbacks: Map<string, string>;
};

export function buildSnapshot(version: string, data: RouteTableData): RouteTableSnapshot {
  return {
    version,
    redirects: new Map(
      data.redirects.map((r) => [r.fromPath, { toPath: r.toPath, statusCode: r.statusCode }]),
    ),
    contentPaths: new Map(data.contentPaths.map((c) => [c.path, c.visibleFrom])),
    localeFallbacks: new Map(data.localeFallbacks.map((f) => [f.path, f.toPath])),
  };
}

export type RouteDecision =
  | { kind: 'redirect'; location: string; status: RedirectStatusCode }
  | { kind: 'notFound' }
  | { kind: 'next' };

/**
 * What the proxy should do with `rawPath`. `isContentRoute` tells whether the path belongs to
 * a content route (so a missing entry means 404 rather than "not ours").
 */
export function decideRoute(
  snapshot: RouteTableSnapshot,
  rawPath: string,
  isContentRoute: boolean,
  now: number = Date.now(),
): RouteDecision {
  const path = normalizePath(rawPath);
  if (!path) return { kind: 'next' };
  const redirect = snapshot.redirects.get(path);
  if (redirect) return { kind: 'redirect', location: redirect.toPath, status: redirect.statusCode };
  if (!isContentRoute) return { kind: 'next' };
  if (snapshot.contentPaths.has(path)) {
    const visibleFrom = snapshot.contentPaths.get(path);
    return visibleFrom == null || visibleFrom <= now ? { kind: 'next' } : { kind: 'notFound' };
  }
  const fallback = snapshot.localeFallbacks.get(path);
  if (fallback) return { kind: 'redirect', location: fallback, status: 307 };
  return { kind: 'notFound' };
}

const EPOCH_KEY = Symbol.for('perfume.content.routeTableEpoch');

type GlobalWithEpoch = typeof globalThis & { [EPOCH_KEY]?: number };

function currentEpoch(): number {
  return (globalThis as GlobalWithEpoch)[EPOCH_KEY] ?? 0;
}

/** Forces every route table in this process to reload on its next use. */
export function invalidateRouteTable(): void {
  const g = globalThis as GlobalWithEpoch;
  g[EPOCH_KEY] = currentEpoch() + 1;
}

export type RouteTableCacheOptions = {
  load: () => Promise<{ version: string; data: RouteTableData }>;
  loadVersion: () => Promise<string>;
  checkIntervalMs?: number;
  /** After a failed load, wait this long before trying again (fail open meanwhile). */
  retryAfterMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
};

export function createRouteTableCache(options: RouteTableCacheOptions) {
  const checkInterval = options.checkIntervalMs ?? 5_000;
  const retryAfter = options.retryAfterMs ?? 10_000;
  const now = options.now ?? Date.now;

  let snapshot: RouteTableSnapshot | null = null;
  let loadedEpoch = -1;
  let lastCheck = 0;
  let failedAt = -Infinity;
  let inflight: Promise<RouteTableSnapshot | null> | null = null;
  let checking = false;

  async function reload(): Promise<RouteTableSnapshot | null> {
    const epoch = currentEpoch();
    try {
      const { version, data } = await options.load();
      snapshot = buildSnapshot(version, data);
      loadedEpoch = epoch;
      lastCheck = now();
      return snapshot;
    } catch (error) {
      failedAt = now();
      options.onError?.(error);
      return snapshot;
    }
  }

  function reloadOnce(): Promise<RouteTableSnapshot | null> {
    inflight ??= reload().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function backgroundCheck() {
    if (checking) return;
    checking = true;
    lastCheck = now();
    try {
      const version = await options.loadVersion();
      if (version !== snapshot?.version) await reloadOnce();
    } catch (error) {
      options.onError?.(error);
    } finally {
      checking = false;
    }
  }

  return {
    /** Current snapshot, or null when it could not be loaded (callers fail open). */
    async get(): Promise<RouteTableSnapshot | null> {
      const t = now();
      if (!snapshot || loadedEpoch !== currentEpoch()) {
        if (t - failedAt < retryAfter) return snapshot;
        return reloadOnce();
      }
      if (t - lastCheck >= checkInterval) void backgroundCheck();
      return snapshot;
    },
  };
}
