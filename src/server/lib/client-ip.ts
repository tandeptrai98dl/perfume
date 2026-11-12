import { isIP } from 'node:net';

/**
 * Trusted client IP (ARCHITECTURE.md §12 "Rate limiting", "Payments"). One helper for every
 * caller: rate limits, Turnstile `remoteip`, the gateway IP allowlist, `orders.ip_address` and
 * audit logs.
 *
 * Only the header named by `TRUSTED_IP_HEADER` is read, because every other forwarding header
 * can be set by the client. Production sits behind Cloudflare → Caddy, so the header is
 * `cf-connecting-ip` (origin reachable only from Cloudflare) or a header Caddy overwrites with
 * `{client_ip}` (see docs/ops/runbook.md). When the header is unset nothing is trusted and the
 * IP is unknown (`null`): callers fall back to a shared bucket, never to `x-forwarded-for`.
 *
 * A comma-separated value (an appended `x-forwarded-for`) uses its right-most entry: the
 * address the nearest trusted proxy saw. Earlier entries are client-controlled.
 *
 * No Next.js APIs here: route handlers and Server Actions pass their headers in
 * (`src/server/request-ip.ts` does it for `next/headers`).
 */

type HeaderSource = { get(name: string): string | null };

/** Strips brackets/zone ids and maps IPv4-mapped IPv6 (`::ffff:1.2.3.4`) to IPv4. */
export function normalizeIp(value: string): string | null {
  let candidate = value.trim();
  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'));
  }
  const zone = candidate.indexOf('%');
  if (zone !== -1) candidate = candidate.slice(0, zone);
  const version = isIP(candidate);
  if (version === 0) return null;
  if (version === 6) {
    const lower = candidate.toLowerCase();
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)?.[1];
    if (mapped && isIP(mapped) === 4) return mapped;
    return lower;
  }
  return candidate;
}

/** The client IP from the one trusted header, or null when unset/absent/invalid. */
export function resolveClientIp(
  headers: HeaderSource,
  trustedHeader: string | undefined,
): string | null {
  if (!trustedHeader) return null;
  const raw = headers.get(trustedHeader);
  if (!raw) return null;
  const parts = raw.split(',');
  const last = parts[parts.length - 1];
  return last ? normalizeIp(last) : null;
}

/** 16-bit groups of an IPv6 address, `::` expanded (input already validated). */
function ipv6Groups(ip: string): number[] | null {
  let text = ip;
  // Embedded IPv4 (e.g. 64:ff9b::1.2.3.4) becomes the last two groups.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)?.[1];
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.split('.').map(Number);
    text = `${text.slice(0, -v4.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array.from({ length: fill }, () => '0'), ...right];
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function ipBytes(ip: string): number[] | null {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  if (isIP(normalized) === 4) return normalized.split('.').map(Number);
  const groups = ipv6Groups(normalized);
  if (!groups || groups.some((group) => Number.isNaN(group))) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

/**
 * Rate-limit subject for an IP: IPv4 as is, IPv6 collapsed to its /64 (one customer usually
 * holds a whole /64, so per-address keys would be trivial to rotate).
 */
export function rateLimitIpKey(ip: string | null): string {
  if (!ip) return 'unknown';
  const bytes = ipBytes(ip);
  if (!bytes) return 'unknown';
  if (bytes.length === 4) return bytes.join('.');
  const prefix = [];
  for (let i = 0; i < 8; i += 2) {
    prefix.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  }
  return `${prefix.join(':')}::/64`;
}

export type IpRange = { bytes: number[]; prefix: number };

/** Parses `1.2.3.4`, `1.2.3.0/24`, `2001:db8::/32`; null for anything else. */
export function parseIpRange(entry: string): IpRange | null {
  const [address = '', prefixText, extra] = entry.trim().split('/');
  if (extra !== undefined) return null;
  const bytes = ipBytes(address);
  if (!bytes) return null;
  const maxBits = bytes.length * 8;
  if (prefixText === undefined) return { bytes, prefix: maxBits };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  return prefix <= maxBits ? { bytes, prefix } : null;
}

/**
 * Parses a comma/whitespace-separated allowlist (env). Throws on an invalid entry so a typo
 * fails at boot instead of silently letting nobody (or everybody) through.
 */
export function parseIpAllowlist(value: string | undefined): IpRange[] {
  if (!value?.trim()) return [];
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const range = parseIpRange(entry);
      if (!range) throw new Error(`invalid IP or CIDR range: ${entry}`);
      return range;
    });
}

export function ipInRanges(ip: string | null, ranges: readonly IpRange[]): boolean {
  if (!ip) return false;
  const bytes = ipBytes(ip);
  if (!bytes) return false;
  return ranges.some((range) => {
    if (range.bytes.length !== bytes.length) return false;
    let bits = range.prefix;
    for (let i = 0; i < bytes.length && bits > 0; i += 1) {
      const take = Math.min(8, bits);
      const mask = (0xff << (8 - take)) & 0xff;
      if (((bytes[i] ?? 0) & mask) !== ((range.bytes[i] ?? 0) & mask)) return false;
      bits -= take;
    }
    return true;
  });
}
