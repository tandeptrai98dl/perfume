/**
 * Runs once when the server starts. Fail fast on invalid configuration.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { serverEnv } = await import('@/lib/env');
    serverEnv();
  }
}
