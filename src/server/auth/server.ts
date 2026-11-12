import 'server-only';

import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import { getTurnstileVerifier } from '@/server/integrations/turnstile';
import { getProducer } from '@/server/jobs/producer';
import { enqueue } from '@/server/jobs/queue';

import { createAuth, type Auth } from './config';

let auth: Auth | undefined;

/**
 * Lazily created Better Auth instance for the Next.js app. Lazy so `next build` never needs
 * runtime secrets; env is validated at boot by `src/instrumentation.ts`.
 */
export function getAuth(): Auth {
  auth ??= createAuth(getDb(), serverEnv(), {
    // Outbox: the worker renders and sends verification / reset e-mails.
    enqueueAuthEmail: async (job) => {
      await enqueue(await getProducer(), getDb(), 'auth.email', job);
    },
    turnstile: getTurnstileVerifier(),
  });
  return auth;
}
