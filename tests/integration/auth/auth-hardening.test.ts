import { like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuth, type Auth } from '@/server/auth/config';
import { createDb, type Database } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';
import type { TurnstileVerifier } from '@/server/integrations/turnstile';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * §12 hardening of the Better Auth endpoints: Turnstile on sign-up / sign-in / password reset
 * (token in `x-turnstile-token`), and the per-IP limits stored in the shared `rate_limits`
 * table, keyed by TRUSTED_IP_HEADER only.
 */

const APP_URL = 'http://localhost:3000';
const env = {
  APP_URL,
  BETTER_AUTH_SECRET: 'integration-test-secret-integration-test-secret',
  NODE_ENV: 'test' as const,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  TRUSTED_IP_HEADER: 'x-client-ip',
};

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

/** Turnstile double: `ok-<action>` tokens pass for that action; remembers the remote IPs. */
const seenIps: (string | null | undefined)[] = [];
const turnstile: TurnstileVerifier = {
  async verify({ token, remoteIp, expectedAction }) {
    seenIps.push(remoteIp);
    return token === `ok-${expectedAction}`
      ? { success: true, hostname: 'localhost', action: expectedAction ?? null }
      : { success: false, errorCodes: ['invalid-input-response'] };
  },
};

function post(auth: Auth, path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${APP_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.execute(sql`truncate ${rateLimits}`);
  seenIps.length = 0;
});

describe('Turnstile on auth endpoints', () => {
  let auth: Auth;
  beforeAll(() => {
    auth = createAuth(db, env, { turnstile });
  });

  const credentials = { email: 'nobody@example.com', password: 'wrong-password-123' };

  it('rejects sign-in without a valid token for the sign-in action', async () => {
    const missing = await post(auth, '/sign-in/email', credentials);
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ code: 'CAPTCHA_FAILED' });

    const otherAction = await post(auth, '/sign-in/email', credentials, {
      'x-turnstile-token': 'ok-sign-up',
    });
    expect(otherAction.status).toBe(403);
  });

  it('lets a valid token through to the normal answer and passes the trusted IP', async () => {
    const response = await post(auth, '/sign-in/email', credentials, {
      'x-turnstile-token': 'ok-sign-in',
      'x-client-ip': '203.0.113.10',
      'x-forwarded-for': '6.6.6.6',
    });
    expect(response.status).toBe(401);
    expect(seenIps).toEqual(['203.0.113.10']);
  });

  it('guards sign-up and password reset too, but not other endpoints', async () => {
    const signUp = await post(auth, '/sign-up/email', {
      email: 'new@example.com',
      password: 'correct-horse-battery',
      name: 'New',
    });
    expect(signUp.status).toBe(403);
    const reset = await post(auth, '/request-password-reset', { email: 'new@example.com' });
    expect(reset.status).toBe(403);
    const resetOk = await post(
      auth,
      '/request-password-reset',
      { email: 'new@example.com' },
      { 'x-turnstile-token': 'ok-forgot-password' },
    );
    expect(resetOk.status).toBe(200);
    // Sign-out has no widget and is never challenged.
    expect((await post(auth, '/sign-out', {})).status).not.toBe(403);
  });
});

describe('auth rate limits in rate_limits', () => {
  let auth: Auth;
  beforeAll(() => {
    auth = createAuth(db, env, { rateLimitEnabled: true });
  });

  const credentials = { email: 'nobody@example.com', password: 'wrong-password-123' };

  it('allows 10 sign-ins per minute per trusted IP and ignores x-forwarded-for', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await post(auth, '/sign-in/email', credentials, {
        'x-client-ip': '198.51.100.5',
        // Rotating a client-set header must not create new buckets.
        'x-forwarded-for': `10.0.0.${i}`,
      });
      expect(response.status).toBe(401);
    }
    const blocked = await post(auth, '/sign-in/email', credentials, {
      'x-client-ip': '198.51.100.5',
      'x-forwarded-for': '10.0.0.99',
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('x-retry-after'))).toBeGreaterThan(0);

    const otherIp = await post(auth, '/sign-in/email', credentials, {
      'x-client-ip': '198.51.100.6',
    });
    expect(otherIp.status).toBe(401);

    const rows = await db
      .select({ key: rateLimits.key, count: rateLimits.count })
      .from(rateLimits)
      .where(like(rateLimits.key, 'auth:%'));
    expect(rows.map((row) => row.count).sort((a, b) => a - b)).toEqual([1, 11]);
    expect(rows.every((row) => !row.key.includes('198.51.100'))).toBe(true);
  });
});
