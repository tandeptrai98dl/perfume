/**
 * Vietnamese mobile numbers (§10.4): 10 digits starting with a mobile prefix assigned by the
 * Ministry of Information and Communications after the 2018 conversion from 11 digits.
 * Shared by the storefront forms (client) and the server (Zod schemas); no I/O.
 *
 * Prefixes: Viettel 032–039, 086, 096–098 · Vinaphone 081–085, 088, 091, 094 · MobiFone 070,
 * 076–079, 089, 090, 093 · Vietnamobile 052, 056, 058, 092 · Gmobile 059, 099 · Reddi 055 ·
 * iTel 087. Landlines (02x) and retired ranges (095, 080) are rejected.
 */
export const VN_MOBILE_PATTERN = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-46-9])\d{7}$/;

/**
 * Strips spaces, dots, dashes and brackets and converts the international form (+84 / 84 /
 * 0084) to the national 0xxxxxxxxx form. Returns the input unchanged (trimmed) when it does not
 * look like a phone number, so validation can report it.
 */
export function normalizeVietnamesePhone(input: string): string {
  const compact = input.trim().replace(/[\s.\-()]/g, '');
  const international = /^(?:\+84|0084|84)(\d{9})$/.exec(compact);
  if (international) return `0${international[1]}`;
  return compact;
}

export function isVietnameseMobile(input: string): boolean {
  return VN_MOBILE_PATTERN.test(normalizeVietnamesePhone(input));
}

/** "0912345678" → "0912 345 678" for display (read aloud over the phone). */
export function formatVietnamesePhone(phone: string): string {
  const normalized = normalizeVietnamesePhone(phone);
  if (!/^0\d{9}$/.test(normalized)) return phone;
  return `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
}
