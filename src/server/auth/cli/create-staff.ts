/**
 * Creates (or promotes) a staff account. TOTP enrolment happens on first sign-in at /admin.
 *
 *   STAFF_PASSWORD='…' pnpm auth:create-staff --email owner@example.com --name "Owner" --role owner
 *
 * The password is read from STAFF_PASSWORD (or stdin) so it never lands in shell history.
 */
import { parseArgs } from 'node:util';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { createAuth } from '@/server/auth/config';
import { STAFF_ROLES } from '@/server/auth/permissions';
import { createDb } from '@/server/db/client';
import { users } from '@/server/db/schema';

const argsSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(STAFF_ROLES),
});

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
  });
  const args = argsSchema.parse(values);
  const env = serverEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, args.email) });
    if (existing) {
      await db.update(users).set({ role: args.role }).where(eq(users.id, existing.id));
      console.log(`Updated role to ${args.role} for existing user ${existing.id}`);
      return;
    }
    const password = process.env.STAFF_PASSWORD || (await readStdin());
    if (password.length < 8)
      throw new Error('Set STAFF_PASSWORD (min 8 characters) or pipe it on stdin');

    const auth = createAuth(db, env);
    const { user } = await auth.api.signUpEmail({
      body: { email: args.email, name: args.name, password },
    });
    await db
      .update(users)
      .set({ role: args.role, emailVerified: true })
      .where(eq(users.id, user.id));
    console.log(
      `Created ${args.role} ${user.id}. Sign in at ${env.APP_URL}/admin/login to enrol TOTP.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
