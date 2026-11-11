import 'server-only';

import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';

import { createAuth, type Auth } from './config';

let auth: Auth | undefined;

/**
 * Lazily created Better Auth instance for the Next.js app. Lazy so `next build` never needs
 * runtime secrets; env is validated at boot by `src/instrumentation.ts`.
 */
export function getAuth(): Auth {
  auth ??= createAuth(getDb(), serverEnv());
  return auth;
}
