import 'server-only';

import { headers } from 'next/headers';

import { serverEnv } from '@/lib/env';
import { resolveClientIp } from '@/server/lib/client-ip';

/**
 * Trusted client IP of the current request (Server Components, Server Actions, Route
 * Handlers). Reads only `TRUSTED_IP_HEADER` (see `src/server/lib/client-ip.ts`); null when it
 * is unset or absent. Use this everywhere instead of reading forwarding headers directly.
 */
export async function getClientIp(): Promise<string | null> {
  return resolveClientIp(await headers(), serverEnv().TRUSTED_IP_HEADER);
}
