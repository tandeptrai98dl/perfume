/**
 * Post-sign-in redirects (ARCHITECTURE.md §12): only same-origin paths are followed, so a
 * crafted `?next=` can never send a customer to another site (open redirect).
 */

const PLACEHOLDER_ORIGIN = 'https://internal.invalid';

/** Paths that are never a sensible place to land after signing in. */
const BLOCKED_PREFIXES = ['/api/', '/_next/'];

/**
 * Returns `value` when it is a safe internal path (with its query and hash), else `fallback`.
 * Rejects absolute and protocol-relative URLs (`//evil.com`, `/\evil.com`), schemes
 * (`javascript:`), control characters and API routes.
 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Browsers strip tabs/newlines and treat backslashes as slashes: refuse them outright.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (BLOCKED_PREFIXES.some((prefix) => `${url.pathname}/`.startsWith(prefix))) return fallback;
  return path;
}
