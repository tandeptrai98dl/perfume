import { randomInt } from 'node:crypto';

/** No 0/O/1/I/L: codes are read aloud over the phone (§6.2 "PF-261111-7K3Q"). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** `PF-YYMMDD-XXXX` in Vietnam time. Uniqueness is enforced by the DB; callers retry on clash. */
export function generateOrderCode(
  now: Date = new Date(),
  random: (max: number) => number = randomInt,
): string {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const date = `${String(vn.getUTCFullYear()).slice(2)}${String(vn.getUTCMonth() + 1).padStart(2, '0')}${String(vn.getUTCDate()).padStart(2, '0')}`;
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ALPHABET[random(ALPHABET.length)];
  return `PF-${date}-${suffix}`;
}

export const ORDER_CODE_PATTERN = /^PF-\d{6}-[2-9A-HJKMNP-Z]{4}$/;
