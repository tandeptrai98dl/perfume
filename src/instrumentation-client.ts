import * as Sentry from '@sentry/nextjs';

import { clientEnv } from '@/lib/env';
import { sentryOptions } from '@/lib/observability/sentry-options';

// Browser error reporting; only initialised when NEXT_PUBLIC_SENTRY_DSN is set at build time.
if (clientEnv.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init(
    sentryOptions({
      dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.05,
    }),
  );
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
