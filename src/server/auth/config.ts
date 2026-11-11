import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ServerEnv } from '@/lib/env';
import { parseVietnamesePhone } from '@/lib/phone';
import { localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import type { JobInput } from '@/server/jobs/definitions';
import { newId } from '@/server/lib/ids';
import { errorFields, logger } from '@/server/lib/logger';
import { CART_COOKIE, mergeGuestCartFromCookieHeader } from '@/server/modules/cart';

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
> &
  Partial<Pick<ServerEnv, 'AUTH_RATE_LIMIT'>>;

/** Password reset links are single-use and expire after 30 minutes (§10.6). */
export const RESET_PASSWORD_TTL_SECONDS = 30 * 60;
/** Email verification links expire after 24 hours. */
export const VERIFY_EMAIL_TTL_SECONDS = 24 * 60 * 60;

export type AuthEmailJob = JobInput<'auth.email'>;

/**
 * Side effects injected by the caller. The web app enqueues the `auth.email` outbox job
 * (the worker renders and sends it, never the request); tests capture the payloads.
 */
export type AuthDeps = {
  enqueueAuthEmail?: (job: AuthEmailJob) => Promise<void>;
};

type Locale = 'vi' | 'en';

function toLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'vi';
}

/**
 * The reset link goes through Better Auth (`/api/auth/reset-password/:token`, which checks the
 * token) and lands on the reset page in the user's language, whatever page asked for it.
 */
function resetLinkFor(url: string, locale: Locale): string {
  const link = new URL(url);
  link.searchParams.set('callbackURL', localizedPath(locale, '/reset-password'));
  return link.toString();
}

export function createAuth(db: Database, env: AuthEnv, deps: AuthDeps = {}) {
  async function sendAuthEmail(job: AuthEmailJob) {
    if (!deps.enqueueAuthEmail) {
      logger.warn('auth.email.not_configured', { kind: job.kind });
      return;
    }
    try {
      await deps.enqueueAuthEmail(job);
    } catch (error) {
      // Never reveal delivery problems to the client (no account enumeration); log only.
      logger.error('auth.email.enqueue_failed', { kind: job.kind, ...errorFields(error) });
    }
  }

  async function localeOf(user: { id: string; locale?: unknown }): Promise<Locale> {
    if (user.locale === 'vi' || user.locale === 'en') return user.locale;
    const row = await db.query.users.findFirst({
      columns: { locale: true },
      where: eq(schema.users.id, user.id),
    });
    return toLocale(row?.locale);
  }

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
      // Verification required: sign-up then answers the same for new and existing e-mails
      // (Better Auth's generic duplicate response), so it cannot be used to find accounts.
      requireEmailVerification: true,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
      // Password reset e-mails go through the worker outbox; all sessions are revoked.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const locale = await localeOf(user);
        await sendAuthEmail({
          to: user.email,
          locale,
          kind: 'reset_password',
          url: resetLinkFor(url, locale),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Unverified sign-in attempts (correct password) get a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_EMAIL_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({
          to: user.email,
          locale: await localeOf(user),
          kind: 'verify_email',
          url,
        });
      },
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
        // Preferred language for account e-mails (§10.6); set from the sign-up page's locale.
        locale: {
          type: 'string',
          required: false,
          input: true,
          defaultValue: 'vi',
          validator: { input: z.enum(['vi', 'en']) },
        },
        phone: {
          type: 'string',
          required: false,
          input: true,
          validator: {
            input: z
              .string()
              .refine((value) => parseVietnamesePhone(value) !== null)
              .nullish(),
          },
        },
        banned: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT !== 'off',
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
          after: async (session, ctx) => {
            await db
              .update(schema.users)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.users.id, session.userId));
            // Cart (§10.3): merge the guest cart of this browser into the member cart. A failure
            // never blocks sign-in; src/server/cart-session.ts retries on the next request.
            const cookieHeader =
              ctx?.headers?.get('cookie') ?? ctx?.request?.headers.get('cookie') ?? null;
            await mergeGuestCartFromCookieHeader(
              db,
              session.userId,
              cookieHeader,
              CART_COOKIE,
            ).catch((error: unknown) => logger.warn('cart.merge.failed', errorFields(error)));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
