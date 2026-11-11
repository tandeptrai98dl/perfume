import { createHash, randomBytes } from 'node:crypto';

/** httpOnly cookie holding a guest cart token (30 days, §10.3). Only its hash is stored. */
export const CART_COOKIE = 'cart_token';
export const CART_TTL_DAYS = 30;

export function newCartToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCartToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
