import { eq } from 'drizzle-orm';

import { carts } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

import type { CartRow } from './queries';

/*
 * Cart side of `placeOrder` (checkout stream). Runs inside the order transaction so a cart is
 * converted exactly once: the row lock serializes double submits and concurrent tabs.
 */

/** Locks the cart row (`SELECT … FOR UPDATE`); null when it does not exist. */
export async function lockCart(tx: Tx, cartId: string): Promise<CartRow | null> {
  const [cart] = await tx.select().from(carts).where(eq(carts.id, cartId)).for('update');
  return cart ?? null;
}

/** Marks the cart as turned into an order; it is no longer returned by `findActiveCart`. */
export async function markCartConverted(tx: Tx, cartId: string): Promise<void> {
  await tx.update(carts).set({ status: 'converted' }).where(eq(carts.id, cartId));
}
