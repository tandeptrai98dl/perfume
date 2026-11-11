import { randomInt } from 'node:crypto';

/**
 * Gateway transaction references (`payments.txn_ref`). Numeric so the same value works as
 * VNPay `vnp_TxnRef` and payOS `orderCode` (positive integer ≤ 2^53 − 1):
 * `yyMMddHHmmss` (Vietnam time) + 4 random digits = 16 digits, < 9.0 × 10^15 until 2089.
 * Uniqueness is enforced by the DB; callers retry on a clash.
 */
export function generateTxnRef(
  now: Date = new Date(),
  random: (max: number) => number = randomInt,
): string {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${String(vn.getUTCFullYear()).slice(2)}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}` +
    `${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`;
  return `${stamp}${String(random(10_000)).padStart(4, '0')}`;
}

export const TXN_REF_PATTERN = /^\d{16}$/;

/** Transfer note for an order: the order code without dashes (banks drop symbols). */
export function transferNote(orderCode: string): string {
  return orderCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
