import { z } from 'zod';

/**
 * Server-side environment schema. Validated once at boot (see `src/instrumentation.ts`).
 * Payment and other secrets live only here, never in the database (ADR-0007).
 * Add variables in the task that introduces them, and mirror them in `.env.example`.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
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

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
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
