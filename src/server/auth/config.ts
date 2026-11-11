import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { eq } from 'drizzle-orm';

import type { ServerEnv } from '@/lib/env';
import type { Database } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { newId } from '@/server/lib/ids';

import { isStaffRole } from './permissions';

/**
 * Better Auth configuration (ARCHITECTURE.md §4.1 and §12).
 *
 * This file is a pure factory so integration tests can build an instance against a test
 * database. Next.js code uses the singleton from `./server.ts`.
 */

/** Endpoints that create a session only after a successful second factor. */
const SECOND_FACTOR_PATHS = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

/** OAuth callbacks (social providers and generic OAuth). Staff may never sign in this way. */
function isOAuthCallback(path: string | undefined): boolean {
  return !!path && (path.startsWith('/callback/') || path.startsWith('/oauth2/callback'));
}

export const AUTH_ERROR_CODES = {
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  STAFF_OAUTH_FORBIDDEN: 'STAFF_OAUTH_FORBIDDEN',
} as const;

export type AuthEnv = Pick<
  ServerEnv,
  'APP_URL' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'NODE_ENV'
>;

export function createAuth(db: Database, env: AuthEnv) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    appName: 'Perfume Store',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        twoFactors: schema.twoFactors,
      },
    }),
    advanced: {
      // UUIDv7 from the app, never DB-generated (ADR-0010).
      database: { generateId: () => newId() },
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Password reset e-mails go through the worker outbox (M2); all sessions are revoked.
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: google,
    account: {
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Read from the DB on every request: role, ban and 2FA flags must be authoritative.
      cookieCache: { enabled: false },
      additionalFields: {
        twoFactorVerified: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, input: false, defaultValue: 'customer' },
        locale: { type: 'string', required: false, input: true, defaultValue: 'vi' },
        phone: { type: 'string', required: false, input: true },
        banned: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV === 'production',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 10 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
        '/request-password-reset': { window: 600, max: 5 },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Perfume Store',
        // Admin sessions must prove the second factor every time (no trusted devices).
        trustDeviceMaxAge: 0,
        totpOptions: { period: 30, digits: 6 },
        backupCodeOptions: { amount: 10, length: 10 },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const user = await db.query.users.findFirst({
              columns: { role: true, banned: true, deletedAt: true },
              where: eq(schema.users.id, session.userId),
            });
            if (!user || user.banned || user.deletedAt) {
              throw new APIError('FORBIDDEN', {
                message: 'Account is locked',
                code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
              });
            }
            if (isStaffRole(user.role) && isOAuthCallback(ctx?.path)) {
              throw new APIError('FORBIDDEN', {
                message: 'Staff accounts must sign in with email, password and TOTP',
                code: AUTH_ERROR_CODES.STAFF_OAUTH_FORBIDDEN,
              });
            }
            return {
              data: {
                ...session,
                twoFactorVerified: !!ctx?.path && SECOND_FACTOR_PATHS.has(ctx.path),
              },
            };
          },
          after: async (session) => {
            await db
              .update(schema.users)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.users.id, session.userId));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
