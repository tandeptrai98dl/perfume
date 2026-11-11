import { z } from 'zod';

/**
 * Server-side environment schema. Validated once at boot (see `src/instrumentation.ts`).
 * Payment and other secrets live only here, never in the database (ADR-0007).
 * Add variables in the task that introduces them, and mirror them in `.env.example`.
 */
const DEV_AUTH_SECRET = 'dev-only-insecure-better-auth-secret-change-me';

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')
      .default('postgres://perfume:perfume@localhost:5432/perfume'),
    /** Signs cookies and encrypts TOTP secrets. Generate with `openssl rand -base64 32`. */
    BETTER_AUTH_SECRET: z.string().min(32).default(DEV_AUTH_SECRET),
    /** Google sign-in for customers only (staff cannot use OAuth). Both or neither. */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'must be set to a random value in production',
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
  });

/** Client-exposed variables must be prefixed with NEXT_PUBLIC_. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Perfume Store'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** Treats `KEY=` (empty, as in `.env.example`) the same as an unset variable. */
function withoutEmptyValues(source: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(withoutEmptyValues(source));
  if (!result.success) throw new EnvValidationError(formatIssues(result.error));
  return result.data;
}

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError(formatIssues(result.error));
  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Lazily parsed server env. Throws `EnvValidationError` on the first access if invalid. */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/**
 * Client env must reference each variable explicitly so Next.js can inline it at build time.
 */
export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
