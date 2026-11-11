import * as Sentry from '@sentry/nextjs';

/**
 * Runs once when the server starts. Fails fast on invalid configuration and starts Sentry
 * (only when SENTRY_DSN is set).
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { serverEnv } = await import('@/lib/env');
    const { sentryOptions } = await import('@/lib/observability/sentry-options');
    const env = serverEnv();
    if (!env.SENTRY_DSN) return;
    Sentry.init(
      sentryOptions({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      }),
    );
  }
}

/** Reports errors from Server Components, Route Handlers, Server Actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
