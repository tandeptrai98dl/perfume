import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkAdminSession } from '@/server/auth/admin-access';
import { createAuth, type Auth } from '@/server/auth/config';
import { createDb, type Database } from '@/server/db/client';
import { sessions, users } from '@/server/db/schema';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { totp } from '../helpers/totp';

const APP_URL = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let auth: Auth;

/** Minimal cookie jar so requests behave like a browser talking to /api/auth. */
class Browser {
  private cookies = new Map<string, string>();

  async post(path: string, body: unknown): Promise<Response> {
    return this.send(path, { method: 'POST', body: JSON.stringify(body) });
  }

  async get(path: string): Promise<Response> {
    return this.send(path, { method: 'GET' });
  }

  get cookieHeader(): Headers {
    return new Headers({ cookie: this.serialize() });
  }

  private serialize() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const response = await auth.handler(
      new Request(`${APP_URL}/api/auth${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', origin: APP_URL, cookie: this.serialize() },
      }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (/max-age=0/i.test(header) || value === '') this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    return response;
  }
}

/** Sign-up requires e-mail verification (M2): confirm in the DB, then sign in. */
async function signUp(email: string): Promise<Browser> {
  const browser = new Browser();
  const response = await browser.post('/sign-up/email', {
    email,
    password: PASSWORD,
    name: 'Test',
  });
  expect(response.status).toBe(200);
  await db.update(users).set({ emailVerified: true }).where(eq(users.email, email));
  const signIn = await browser.post('/sign-in/email', { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  return browser;
}

async function currentSession(browser: Browser) {
  return auth.api.getSession({ headers: browser.cookieHeader });
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  auth = createAuth(db, {
    APP_URL,
    BETTER_AUTH_SECRET: 'integration-test-secret-integration-test-secret',
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  });
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('Better Auth integration', () => {
  it('creates users and sessions with UUIDv7 ids and an unverified 2FA flag', async () => {
    const browser = await signUp('customer@example.com');
    const current = await currentSession(browser);
    expect(current?.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(current?.session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(current?.user.role).toBe('customer');
    expect(current?.session.twoFactorVerified).toBe(false);
    expect(checkAdminSession(current)).toBe('notStaff');

    const [row] = await db.select().from(users).where(eq(users.email, 'customer@example.com'));
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('ignores attempts to set role or the 2FA flag from the client', async () => {
    const browser = new Browser();
    const response = await browser.post('/sign-up/email', {
      email: 'sneaky@example.com',
      password: PASSWORD,
      name: 'Sneaky',
      role: 'owner',
      banned: false,
      twoFactorVerified: true,
    });
    // Better Auth either rejects or drops `input: false` fields; never trusts them.
    if (response.ok) {
      const current = await currentSession(browser);
      expect(current?.session.twoFactorVerified ?? false).toBe(false);
    }
    const [row] = await db.select().from(users).where(eq(users.email, 'sneaky@example.com'));
    expect(row?.role ?? 'customer').toBe('customer');
    expect(row?.banned ?? false).toBe(false);
  });

  it('only marks a session verified after TOTP, and admin access follows', async () => {
    const email = 'owner@example.com';
    const browser = await signUp(email);
    await db.update(users).set({ role: 'owner' }).where(eq(users.email, email));

    // Password-only session: staff must enrol first.
    expect(checkAdminSession(await currentSession(browser))).toBe('twoFactorSetupRequired');

    const enable = await browser.post('/two-factor/enable', { password: PASSWORD, method: 'totp' });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = new URL(totpURI).searchParams.get('secret')!;
    expect(backupCodes).toHaveLength(10);

    const confirm = await browser.post('/two-factor/verify-totp', { code: totp(secret) });
    expect(confirm.status).toBe(200);
    const enrolled = await currentSession(browser);
    expect(enrolled?.user.twoFactorEnabled).toBe(true);
    expect(enrolled?.session.twoFactorVerified).toBe(true);
    expect(checkAdminSession(enrolled, 'settings.manage')).toBeNull();

    // A fresh sign-in stops at the second factor and creates no session yet.
    const second = new Browser();
    const signIn = await second.post('/sign-in/email', { email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    expect(await currentSession(second)).toBeNull();

    const wrong = await second.post('/two-factor/verify-totp', { code: '000000' });
    expect(wrong.status).toBe(401);

    const verified = await second.post('/two-factor/verify-totp', { code: totp(secret) });
    expect(verified.status).toBe(200);
    const secondSession = await currentSession(second);
    expect(secondSession?.session.twoFactorVerified).toBe(true);

    // Backup codes also count as a second factor.
    const third = new Browser();
    await third.post('/sign-in/email', { email, password: PASSWORD });
    const backup = await third.post('/two-factor/verify-backup-code', { code: backupCodes[0] });
    expect(backup.status).toBe(200);
    expect((await currentSession(third))?.session.twoFactorVerified).toBe(true);
  });

  it('refuses sessions for locked accounts', async () => {
    const email = 'locked@example.com';
    await signUp(email);
    const [user] = await db
      .update(users)
      .set({ banned: true })
      .where(eq(users.email, email))
      .returning();
    await db.delete(sessions).where(eq(sessions.userId, user!.id));

    const browser = new Browser();
    const response = await browser.post('/sign-in/email', { email, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(await currentSession(browser)).toBeNull();
  });

  it('returns the same error for unknown emails and wrong passwords', async () => {
    const unknown = await new Browser().post('/sign-in/email', {
      email: 'nobody@example.com',
      password: PASSWORD,
    });
    const wrong = await new Browser().post('/sign-in/email', {
      email: 'customer@example.com',
      password: 'wrong-password',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await unknown.json()).code).toBe((await wrong.json()).code);
  });
});
