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

    // ---------- M2 payments (ADR-0007: secrets only here, never in the DB or admin) ----------
    /** VNPay merchant (terminal) code and HMAC-SHA512 hash secret. Both or neither. */
    VNPAY_TMN_CODE: z.string().min(1).optional(),
    VNPAY_HASH_SECRET: z.string().min(1).optional(),
    VNPAY_PAYMENT_URL: z.url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
    /** VNPay merchant API (refunds, queries). */
    VNPAY_API_URL: z.url().default('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
    /** payOS (VietQR) channel credentials. All three or none. */
    PAYOS_CLIENT_ID: z.string().min(1).optional(),
    PAYOS_API_KEY: z.string().min(1).optional(),
    PAYOS_CHECKSUM_KEY: z.string().min(1).optional(),
    PAYOS_API_URL: z.url().default('https://api-merchant.payos.vn'),
    /**
     * Sandbox simulator for VNPay and payOS (no network, signed with public dev keys). On by
     * default outside production for gateways without keys; `true` forces it for every gateway
     * (E2E). Refused in production unless APP_URL is localhost.
     */
    /**
     * `off` disables Better Auth's per-IP rate limits for E2E runs against a production build
     * (every test account signs in from one IP). Refused in production unless APP_URL is localhost.
     */
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
    PAYMENT_SIMULATOR: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    // ---------- M2 account & notifications ----------
    /** Internal alerts by email (new order, high-value COD, …, ADR-0019); skipped when unset. */
    STAFF_ALERT_EMAIL: z.email().optional(),
    /** Telegram bot for internal alerts (ADR-0019). Both or neither; skipped when unset. */
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_CHAT_ID: z.string().min(1).optional(),
    // ---------- M3 e-invoicing (D13, ADR-0013; credentials only here, ADR-0007) ----------
    /**
     * E-invoice provider. Defaults to `sandbox` (no network, fake invoice numbers) outside
     * production; production builds need `misa` or `viettel` with credentials (`sandbox` only
     * on localhost, for E2E). Unset in production = invoices are not issued (job fails + alert).
     */
    EINVOICE_PROVIDER: z.enum(['sandbox', 'misa', 'viettel']).optional(),
    /** Invoice template ("mẫu số", e.g. `1/001`) and series ("ký hiệu", e.g. `C26TAA`). */
    EINVOICE_TEMPLATE_CODE: z.string().min(1).max(20).optional(),
    EINVOICE_SERIES: z.string().min(1).max(20).optional(),
    /** MISA meInvoice integration API (test host by default) and account. */
    EINVOICE_MISA_BASE_URL: z.url().default('https://testapi.meinvoice.vn/api/integration'),
    EINVOICE_MISA_APP_ID: z.string().min(1).optional(),
    EINVOICE_MISA_TAX_CODE: z.string().min(1).optional(),
    EINVOICE_MISA_USERNAME: z.string().min(1).optional(),
    EINVOICE_MISA_PASSWORD: z.string().min(1).optional(),
    /** Viettel S-Invoice API; the username is the seller's tax code. */
    EINVOICE_VIETTEL_BASE_URL: z.url().default('https://api-vinvoice.viettel.vn'),
    EINVOICE_VIETTEL_USERNAME: z.string().min(1).optional(),
    EINVOICE_VIETTEL_PASSWORD: z.string().min(1).optional(),
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
    if (Boolean(env.VNPAY_TMN_CODE) !== Boolean(env.VNPAY_HASH_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VNPAY_HASH_SECRET'],
        message: 'VNPAY_TMN_CODE and VNPAY_HASH_SECRET must be set together',
      });
    }
    const payos = [env.PAYOS_CLIENT_ID, env.PAYOS_API_KEY, env.PAYOS_CHECKSUM_KEY].filter(Boolean);
    if (payos.length !== 0 && payos.length !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYOS_CHECKSUM_KEY'],
        message: 'PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY must be set together',
      });
    }
    if (env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT === 'off') {
      const host = new URL(env.APP_URL).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_RATE_LIMIT'],
          message: 'auth rate limits can only be turned off on localhost in production builds',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_SIMULATOR) {
      const host = new URL(env.APP_URL).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_SIMULATOR'],
          message: 'the payment simulator is only allowed on localhost in production builds',
        });
      }
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
    // M3 e-invoicing: a real provider needs its full account and the invoice series.
    for (const issue of einvoiceEnvIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
  });

function einvoiceEnvIssues(env: {
  NODE_ENV: string;
  APP_URL: string;
  EINVOICE_PROVIDER?: string;
  EINVOICE_TEMPLATE_CODE?: string;
  EINVOICE_SERIES?: string;
  EINVOICE_MISA_APP_ID?: string;
  EINVOICE_MISA_TAX_CODE?: string;
  EINVOICE_MISA_USERNAME?: string;
  EINVOICE_MISA_PASSWORD?: string;
  EINVOICE_VIETTEL_USERNAME?: string;
  EINVOICE_VIETTEL_PASSWORD?: string;
}): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  const required = (keys: (keyof typeof env)[]) => {
    for (const key of keys) {
      if (!env[key]) {
        issues.push({
          path: [key],
          message: `${key} is required when EINVOICE_PROVIDER=${env.EINVOICE_PROVIDER}`,
        });
      }
    }
  };
  if (env.EINVOICE_PROVIDER === 'misa') {
    required([
      'EINVOICE_MISA_APP_ID',
      'EINVOICE_MISA_TAX_CODE',
      'EINVOICE_MISA_USERNAME',
      'EINVOICE_MISA_PASSWORD',
      'EINVOICE_SERIES',
    ]);
  } else if (env.EINVOICE_PROVIDER === 'viettel') {
    required([
      'EINVOICE_VIETTEL_USERNAME',
      'EINVOICE_VIETTEL_PASSWORD',
      'EINVOICE_TEMPLATE_CODE',
      'EINVOICE_SERIES',
    ]);
  } else if (env.EINVOICE_PROVIDER === 'sandbox' && env.NODE_ENV === 'production') {
    const host = new URL(env.APP_URL).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      issues.push({
        path: ['EINVOICE_PROVIDER'],
        message: 'the e-invoice sandbox is only allowed on localhost in production builds',
      });
    }
  }
  return issues;
}

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
