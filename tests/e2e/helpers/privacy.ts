import { Client } from 'pg';

/** DB helpers for the privacy specs (consents, privacy requests, queued privacy e-mails). */

export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for privacy E2E tests');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function consentRow(id: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      purpose: string;
      granted: boolean;
      source: string;
      ip: string | null;
    }>('select purpose, granted, source, host(ip) as ip from consents where id = $1', [id]);
    return result.rows[0] ?? null;
  });
}

export async function userConsents(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{ purpose: string; granted: boolean; source: string }>(
      `select c.purpose, c.granted, c.source from consents c join users u on u.id = c.user_id
       where u.email = $1 order by c.created_at, c.id`,
      [email],
    );
    return result.rows;
  });
}

export async function privacyRequestsFor(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      type: string;
      status: string;
      note: string | null;
    }>('select id, type, status, note from privacy_requests where email = $1 order by created_at', [
      email,
    ]);
    return result.rows;
  });
}

/** What the worker's `privacy.export` job does to the request (no worker runs during E2E). */
export async function completeExport(requestId: string) {
  await withDb((db) =>
    db.query(
      `update privacy_requests set status = 'completed', completed_at = now() where id = $1`,
      [requestId],
    ),
  );
}

/** Confirmation link of the latest queued `privacy.verify-request` e-mail to `to`. */
export async function verificationLink(to: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await withDb(async (db) => {
      const result = await db.query<{ url: string }>(
        `select data->>'url' as url from pgboss.job
         where name = 'privacy.verify-request' and data->>'to' = $1
         order by created_on desc limit 1`,
        [to],
      );
      return result.rows[0]?.url;
    });
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No privacy verification e-mail queued for ${to}`);
}
