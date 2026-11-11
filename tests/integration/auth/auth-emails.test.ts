import { and, eq, gt, like, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuth, type Auth } from '@/server/auth/config';
import { createDb, type Database } from '@/server/db/client';
import { users, verifications } from '@/server/db/schema';
import { createEmailSender, type EmailMessage } from '@/server/integrations/email/send';
import { createHandlers } from '@/server/jobs/handlers';
import { createBoss, enqueue, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

const APP_URL = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let auth: Auth;

type AuthEmailJob = { to: string; locale: 'vi' | 'en'; kind: string; url: string };

async function authJobs(to: string): Promise<AuthEmailJob[]> {
  const result = await db.execute<{ data: AuthEmailJob }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job
        where name = 'auth.email' and data->>'to' = ${to} order by created_on`,
  );
  return result.rows.map((row) => row.data);
}

function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return auth.handler(
    new Request(`${APP_URL}/api/auth${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        origin: APP_URL,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);
  auth = createAuth(
    db,
    {
      APP_URL,
      BETTER_AUTH_SECRET: 'integration-test-secret-integration-test-secret',
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    },
    { enqueueAuthEmail: async (job) => void (await enqueue(boss, db, 'auth.email', job)) },
  );
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('sign-up with e-mail verification', () => {
  it('enqueues a verification e-mail in the sign-up locale and answers duplicates the same way', async () => {
    const email = 'new-customer@example.com';
    const body = {
      email,
      password: PASSWORD,
      name: 'Hương',
      locale: 'en',
      callbackURL: '/en/account',
    };
    const first = await call('/sign-up/email', { body });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { token: string | null };
    expect(firstJson.token).toBeNull();
    expect(first.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(false);

    const duplicate = await call('/sign-up/email', {
      body: { ...body, password: 'another-password' },
    });
    expect(duplicate.status).toBe(200);
    expect(Object.keys((await duplicate.json()) as object).sort()).toEqual(
      Object.keys(firstJson).sort(),
    );

    const jobs = await authJobs(email);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ to: email, locale: 'en', kind: 'verify_email' });

    // The link verifies the address and signs the customer in.
    const verifyUrl = new URL(jobs[0]!.url);
    const verify = await auth.handler(new Request(verifyUrl, { headers: { origin: APP_URL } }));
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe('/en/account');
    expect(verify.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row).toMatchObject({ emailVerified: true, locale: 'en' });
  });

  it('rejects an unknown language on sign-up', async () => {
    const response = await call('/sign-up/email', {
      body: { email: 'fr@example.com', password: PASSWORD, name: 'Fr', locale: 'fr' },
    });
    expect(response.status).toBe(400);
  });
});

describe('password reset', () => {
  it('enqueues auth.email with a 30-minute single-use link in the user’s locale', async () => {
    const email = 'reset@example.com';
    await call('/sign-up/email', { body: { email, password: PASSWORD, name: 'R', locale: 'vi' } });
    await db.update(users).set({ emailVerified: true }).where(eq(users.email, email));

    const response = await call('/request-password-reset', {
      body: { email, redirectTo: '/en/reset-password' },
    });
    expect(response.status).toBe(200);
    const unknown = await call('/request-password-reset', {
      body: { email: 'nobody@example.com', redirectTo: '/reset-password' },
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(await response.clone().json());
    expect(await authJobs('nobody@example.com')).toEqual([]);

    const resets = (await authJobs(email)).filter((job) => job.kind === 'reset_password');
    expect(resets).toHaveLength(1);
    expect(resets[0]!.locale).toBe('vi');
    const link = new URL(resets[0]!.url);
    // The landing page follows the user's language, not the page that asked.
    expect(link.searchParams.get('callbackURL')).toBe('/dat-lai-mat-khau');

    const [token] = await db
      .select({ expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(
        and(
          like(verifications.identifier, 'reset-password:%'),
          gt(verifications.expiresAt, new Date()),
        ),
      );
    const minutes = (token!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);

    const callback = await auth.handler(new Request(link, { headers: { origin: APP_URL } }));
    expect(callback.status).toBe(302);
    const landing = new URL(callback.headers.get('location')!, APP_URL);
    expect(landing.pathname).toBe('/dat-lai-mat-khau');
    const resetToken = landing.searchParams.get('token')!;

    const reset = await call('/reset-password', {
      body: { newPassword: 'new-password-123', token: resetToken },
    });
    expect(reset.status).toBe(200);
    const reuse = await call('/reset-password', {
      body: { newPassword: 'other-password-123', token: resetToken },
    });
    expect(reuse.status).toBe(400);
    const signIn = await call('/sign-in/email', { body: { email, password: 'new-password-123' } });
    expect(signIn.status).toBe(200);
  });

  it('renders and sends the queued e-mail in that locale from the worker handler', async () => {
    const sent: EmailMessage[] = [];
    const email = createEmailSender({
      transport: nodemailer.createTransport({ jsonTransport: true }),
      from: 'Perfume Store <no-reply@example.com>',
    });
    const handlers = createHandlers({
      db,
      boss,
      email: { ...email, send: async (message) => (sent.push(message), email.send(message)) },
      appUrl: APP_URL,
      internalBaseUrl: APP_URL,
      internalSecret: 'x'.repeat(32),
      chat: null,
    });
    const [job] = (await authJobs('reset@example.com')).filter((j) => j.kind === 'reset_password');
    await handlers['auth.email']({ ...job!, kind: 'reset_password' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'reset@example.com', subject: 'Đặt lại mật khẩu' });
  });
});
