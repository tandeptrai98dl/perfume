import { scrubText, scrubValue } from '@/lib/observability/scrub';

/**
 * Minimal structured logger (JSON lines). Messages and fields are PII-scrubbed as a safety
 * net; still prefer masking at the call site (`server/lib/mask.ts`).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  const safeFields = fields ? (scrubValue(fields) as Record<string, unknown>) : undefined;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: scrubText(message),
    ...safeFields,
  });
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
