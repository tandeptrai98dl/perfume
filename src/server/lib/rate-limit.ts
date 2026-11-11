/**
 * Fixed-window rate limiter (ARCHITECTURE.md §12 "Rate limiting"), memory-backed.
 *
 * MVP runs one web instance, so a per-process window is enough; the planned `rate_limits`
 * table (§6.2) or Redis replaces the store when the app scales out — callers only see
 * `RateLimiter`. No Next.js APIs: usable from the worker and tests.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Attempts left in the current window after this one. */
  remaining: number;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
};

export type RateLimiter = {
  /** Counts one attempt for `key` and says whether it is allowed. */
  hit(key: string): RateLimitResult;
  reset(key?: string): void;
};

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Bound on tracked keys so a flood of distinct keys cannot exhaust memory. */
  maxKeys?: number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  function prune(at: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key);
    }
    // Still full: drop the oldest entries (Map keeps insertion order).
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(key) {
      const at = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= at) {
        if (!window && windows.size >= maxKeys) prune(at);
        window = { count: 0, resetAt: at + options.windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count > options.limit) {
        return { ok: false, remaining: 0, retryAfterMs: window.resetAt - at };
      }
      return { ok: true, remaining: options.limit - window.count, retryAfterMs: 0 };
    },
    reset(key) {
      if (key === undefined) windows.clear();
      else windows.delete(key);
    },
  };
}

/** Guest order lookup: 5 attempts per 10 minutes per IP (§10.5, §12). */
export const ORDER_LOOKUP_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;
