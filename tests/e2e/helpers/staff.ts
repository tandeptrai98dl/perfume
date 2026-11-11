import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { totp } from '../../integration/helpers/totp';

export type StaffAccount = {
  email: string;
  password: string;
  /** Base32 TOTP secret, to generate codes like an authenticator app. */
  secret: string;
};

type Role = 'owner' | 'manager' | 'staff' | 'editor';

/** Minimal cookie-aware client for /api/auth on the running app. */
class AuthClient {
  private cookies = new Map<string, string>();
  constructor(private readonly baseURL: string) {}

  async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(new URL(`/api/auth${path}`, this.baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: new URL(this.baseURL).origin,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
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

async function expectOk(response: Response, step: string) {
  if (!response.ok)
    throw new Error(`${step} failed: HTTP ${response.status} ${await response.text()}`);
}

/**
 * Creates a staff account with an enrolled TOTP factor through the real auth endpoints
 * (sign-up, role set in the DB like `pnpm auth:create-staff`, enable + verify TOTP).
 * Each call uses a fresh e-mail so tests never depend on earlier runs.
 */
export async function createStaffWithTotp(
  baseURL: string,
  role: Role,
  databaseUrl = process.env.DATABASE_URL,
): Promise<StaffAccount> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for admin E2E tests');
  const email = `e2e-${role}-${Date.now()}-${randomBytes(3).toString('hex')}@perfume.test`;
  const password = `E2e-${randomBytes(9).toString('base64url')}`;

  const client = new AuthClient(baseURL);
  await expectOk(
    await client.post('/sign-up/email', { email, password, name: `E2E ${role}` }),
    'sign-up',
  );

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query('update users set role = $1, email_verified = true where email = $2', [
      role,
      email,
    ]);
  } finally {
    await db.end();
  }

  const staff = new AuthClient(baseURL);
  await expectOk(await staff.post('/sign-in/email', { email, password }), 'sign-in');
  const enable = await staff.post('/two-factor/enable', { password });
  await expectOk(enable, 'enable 2FA');
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get('secret')!;
  await expectOk(
    await staff.post('/two-factor/verify-totp', { code: totp(secret) }),
    'verify TOTP',
  );
  return { email, password, secret };
}

/** A TOTP code that stays valid for at least a few seconds (avoids window edges). */
export async function freshTotp(secret: string): Promise<string> {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 4) await new Promise((resolve) => setTimeout(resolve, remaining * 1000 + 200));
  return totp(secret);
}

/**
 * Hides catalogue data created by an admin E2E run (soft delete), so storefront assertions on
 * the demo seed stay exact when the suite runs again on the same database.
 */
export async function archiveE2EBrand(brandName: string, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(
      `update products set status = 'archived', deleted_at = now()
       where brand_id in (select id from brands where name = $1)`,
      [brandName],
    );
    await db.query(`update brands set status = 'archived', deleted_at = now() where name = $1`, [
      brandName,
    ]);
  } finally {
    await db.end();
  }
}
