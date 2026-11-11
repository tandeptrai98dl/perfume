/**
 * PII scrubbing for error reports and logs (ARCHITECTURE.md §12, Decree 356/2025).
 * Shared by the browser, the Next.js server and the worker, so it has no dependencies.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Vietnamese mobile/landline numbers: 0xxxxxxxxx or +84 / 84 prefixes, with optional separators.
const PHONE = /(?<![\w])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\w])/g;
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|session|otp|totp|backup|api[-_]?key|card|cvv|address|phone|email|street|ward/i;

export const REDACTED = '[redacted]';

export function scrubText(value: string): string {
  return value.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

/** Deep-scrubs strings and drops values under sensitive keys. Cycles and depth are bounded. */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8 || seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(item, depth + 1, seen);
  }
  return out;
}

/** Removes the query string values of a URL (tokens often travel there). */
export function scrubUrl(url: string): string {
  const index = url.indexOf('?');
  if (index === -1) return scrubText(url);
  const params = new URLSearchParams(url.slice(index + 1));
  const keys = [...new Set(params.keys())].map((key) => `${key}=${REDACTED}`);
  return `${scrubText(url.slice(0, index))}?${keys.join('&')}`;
}

/** Structural subset of a Sentry event; kept local so this module has no SDK dependency. */
export type ScrubbableEvent = {
  message?: string;
  user?: Record<string, unknown>;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    data?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
};

const KEEP_HEADERS = new Set(['user-agent', 'accept-language', 'content-type', 'referer']);

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = scrubText(event.message);
  // Keep only an opaque id; never email, name, IP or username.
  if (event.user) event.user = typeof event.user.id === 'string' ? { id: event.user.id } : {};
  if (event.request) {
    const request = event.request;
    if (request.url) request.url = scrubUrl(request.url);
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers)
          .filter(([key]) => KEEP_HEADERS.has(key.toLowerCase()))
          .map(([key, value]) => [key, key.toLowerCase() === 'referer' ? scrubUrl(value) : value]),
      );
    }
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.tags) event.tags = scrubValue(event.tags) as Record<string, unknown>;
  return event;
}
