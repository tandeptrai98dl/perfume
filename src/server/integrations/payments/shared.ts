import { createHash, timingSafeEqual } from 'node:crypto';

/** Helpers shared by the gateway adapters. */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `yyyyMMddHHmmss` in Vietnam time (GMT+7), as VNPay expects. */
export function vnCompactDate(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}` +
    `${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`
  );
}

/** Parses `yyyyMMddHHmmss` (GMT+7); null when malformed. */
export function parseVnCompactDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  return new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!) - VN_OFFSET_MS);
}

/** Parses `yyyy-MM-dd HH:mm:ss` (GMT+7, payOS); null when malformed. */
export function parseVnDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[-: T]/g, '').slice(0, 14);
  return parseVnCompactDate(compact);
}

/** Constant-time comparison of two hex digests (case-insensitive). */
export function sameHex(expected: string, received: string | null | undefined): boolean {
  if (!received || !/^[0-9a-fA-F]+$/.test(received)) return false;
  const a = Buffer.from(expected.toLowerCase(), 'hex');
  const b = Buffer.from(received.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stable key for notifications that failed verification (never collides with a real one). */
export function invalidEventKey(provider: string, input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? String(input);
  } catch {
    text = String(input);
  }
  return `invalid:${provider}:${createHash('sha256').update(text).digest('hex')}`;
}

/** Keeps the last 3 characters of an account number / name for display. */
export function maskTail(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return `***${value.slice(-3)}`;
}
