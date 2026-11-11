import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/server/auth/server';

/** Better Auth endpoints (sign-in, sign-up, OAuth callbacks, two-factor). */
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
