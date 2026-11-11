/**
 * Minimal structured logger (JSON lines). Never pass raw PII: mask with `server/lib/mask.ts`.
 * Sentry and log shipping come in M0-7.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};

export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { error: error.message, name: error.name }
    : { error: String(error) };
}
