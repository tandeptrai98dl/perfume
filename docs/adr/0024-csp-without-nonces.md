# ADR-0024: Content Security Policy without nonces under Cache Components

- Status: Accepted
- Date: 2026-11-12
- Decision ID: D24 (M3 hardening; refines the "HTTP headers" row of ARCHITECTURE.md §12)

## Context

ARCHITECTURE.md §12 planned a strict CSP with script nonces. The storefront and admin use
Cache Components (`cacheComponents: true`, PPR, `'use cache'`, §14.1): every route is
partially prerendered at build time and catalogue pages are cached after their first request.

The Next.js 16.4 CSP guide states that nonces require dynamic rendering and that PPR is
incompatible with nonce-based CSP. We measured it on our production build with a per-request
nonce set by `proxy.ts` (request + response header, Next.js stamping its own scripts):

| Page | Result |
| --- | --- |
| PPR pages (home, cart, checkout, sign-in) | shell `<script src>` chunks without nonce, plus React's inline `$RT` timing script without nonce |
| Fully static routes (`/admin/login`, 404 shell) | 13 / 4 inline RSC payload scripts without nonce |
| PDP (rendered on first request, then cached) | first response correct; every later response replays the **first request's nonce** in 18 tags |

So a nonce either is missing (blocked scripts, broken hydration, console errors) or is
replayed from a cache entry (which defeats a nonce entirely). Making every page dynamic would
throw away the caching that §14 relies on (TTFB < 200 ms, CDN caching). Hash-based CSP does
not work either: inline RSC payloads differ per page and per cache entry. `'strict-dynamic'`
makes browsers ignore `'self'` and host sources, so it needs a nonce or hashes on the root
scripts.

## Decision

- **Scripts:** `script-src 'self' 'unsafe-inline'` plus a documented host allowlist (GTM,
  GA4, Meta Pixel, Cloudflare Turnstile). No nonce, no `'strict-dynamic'`, no `'unsafe-eval'`
  outside development.
- **Everything else stays strict:** `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` + VNPay/payOS,
  `connect-src`/`img-src`/`frame-src` limited to the same hosts plus the media CDN and the
  Sentry ingest origin, `upgrade-insecure-requests` on https. API responses get
  `default-src 'none'; frame-ancestors 'none'; sandbox`.
- The page policy is set by `proxy.ts` from runtime env (`CSP_REPORT_ONLY`, `CSP_REPORT_URI`,
  defaulting to Sentry's security endpoint); static headers (HSTS, nosniff, Referrer-Policy,
  Permissions-Policy, X-Frame-Options, COOP) come from `next.config.ts`.
- XSS defence relies on React output escaping, the rich-text allowlist sanitizer and Zod
  input validation (§12 Input/output); the CSP limits where scripts load from and where data
  can be sent.
- GTM is configured without Custom HTML tags that inject scripts from other hosts; a new
  third-party host needs a change to `CSP_HOSTS` (code review).

## Consequences

- Caching and PPR keep working; one policy string per process (no per-request work).
- An injected inline script would not be blocked by CSP alone; exfiltration to unknown hosts
  and loading foreign script files are blocked.
- Revisit when Next.js supports nonces for prerendered shells (or Trusted Types/hashes for the
  RSC payload): switch `script-src` to `'nonce-…' 'strict-dynamic'` and drop `'unsafe-inline'`.
  `tests/e2e/security-headers.spec.ts` fails on any CSP violation of key pages, so the change
  can be verified.
