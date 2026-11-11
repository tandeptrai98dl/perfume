import { z } from 'zod';

/**
 * Server-side environment schema. Validated once at boot (see `src/instrumentation.ts`).
 * Payment and other secrets live only here, never in the database (ADR-0007).
 * Add variables in the task that introduces them, and mirror them in `.env.example`.
 */
const DEV_AUTH_SECRET = 'dev-only-insecure-better-auth-secret-change-me';
const DEV_INTERNAL_SECRET = 'dev-only-insecure-internal-api-secret-change-me';

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
    /** HMAC key shared by web and worker for /api/internal/* calls. */
    INTERNAL_API_SECRET: z.string().min(32).default(DEV_INTERNAL_SECRET),
    /** Base URL the worker uses to reach the web app (e.g. http://web:3000 in Docker). */
    INTERNAL_APP_URL: z.url().optional(),
    /** SMTP for transactional email; Mailpit from docker/compose.yml in development. */
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//, 'must be an smtp:// or smtps:// URL')
      .default('smtp://localhost:1025'),
    EMAIL_FROM: z.string().min(3).default('Perfume Store <no-reply@localhost>'),
    /** Error reporting; disabled when unset. Events are PII-scrubbed (src/lib/observability). */
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    /**
     * Media storage (ARCHITECTURE.md §12 uploads). `s3` works with AWS, MinIO and Vietnamese
     * S3-compatible providers; `local` writes to MEDIA_LOCAL_DIR and is served by
     * /api/media (development and tests only). Defaults to `s3` when S3_BUCKET is set.
     */
    MEDIA_STORAGE: z.enum(['s3', 'local']).optional(),
    MEDIA_LOCAL_DIR: z.string().min(1).default('.data/media'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** MinIO and most S3-compatible providers need path-style URLs. */
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    // ---------- M2 account & notifications ----------
    /** Internal alerts by email (new order, high-value COD, …, ADR-0019); skipped when unset. */
    STAFF_ALERT_EMAIL: z.email().optional(),
    /** Telegram bot for internal alerts (ADR-0019). Both or neither; skipped when unset. */
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      const devDefaults = [
        ['BETTER_AUTH_SECRET', env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET],
        ['INTERNAL_API_SECRET', env.INTERNAL_API_SECRET === DEV_INTERNAL_SECRET],
      ] as const;
      for (const [key, isDevDefault] of devDefaults) {
        if (isDevDefault) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'must be set to a random value in production',
          });
        }
      }
    }
    if (env.S3_BUCKET && !(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_BUCKET is set',
      });
    }
    if (env.MEDIA_STORAGE === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when MEDIA_STORAGE=s3',
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
    if (Boolean(env.TELEGRAM_BOT_TOKEN) !== Boolean(env.TELEGRAM_CHAT_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_CHAT_ID'],
        message: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together',
      });
    }
  });

/** Client-exposed variables must be prefixed with NEXT_PUBLIC_. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Perfume Store'),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  /** Public base URL of the media bucket/CDN, e.g. https://cdn.example.vn/media. */
  NEXT_PUBLIC_MEDIA_BASE_URL: z.url().optional(),
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
  const result = clientEnvSchema.safeParse(withoutEmptyValues(source));
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
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
});
