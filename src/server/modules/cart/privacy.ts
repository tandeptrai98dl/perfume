import { eq } from 'drizzle-orm';

import { carts } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

/**
 * Account deletion (privacy requests, M3): a member's carts (lines cascade, gift messages
 * included) are removed in the caller's transaction. Returns the number of carts removed.
 */
export async function deleteCartsForUser(tx: Tx, userId: string): Promise<number> {
  const removed = await tx
    .delete(carts)
    .where(eq(carts.userId, userId))
    .returning({ id: carts.id });
  return removed.length;
}
