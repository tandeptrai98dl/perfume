/**
 * Raw `NEXT_PUBLIC_*` values for browser code, without Zod (keeps ~30 KB gzip of validation
 * code out of every page's first-load JavaScript, ARCHITECTURE.md §14.1). Each variable is
 * referenced explicitly so Next.js inlines it at build time; empty strings count as unset.
 *
 * Validation still happens: `clientEnv` in `./env` parses these same values on the server
 * (the proxy reads it on every request), so an invalid value fails there, never silently.
 * Server code keeps using `clientEnv` for the validated, defaulted values.
 */
const value = (raw: string | undefined) => (raw ? raw : undefined);

export const publicEnv = {
  NEXT_PUBLIC_APP_NAME: value(process.env.NEXT_PUBLIC_APP_NAME),
  NEXT_PUBLIC_SENTRY_DSN: value(process.env.NEXT_PUBLIC_SENTRY_DSN),
  NEXT_PUBLIC_MEDIA_BASE_URL: value(process.env.NEXT_PUBLIC_MEDIA_BASE_URL),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: value(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  NEXT_PUBLIC_GTM_ID: value(process.env.NEXT_PUBLIC_GTM_ID),
};
