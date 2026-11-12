import { and, count, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { products, wishlists } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';

/**
 * Member wishlist (§10.6, `wishlists` PK(user_id, product_id)). Customer module owns the table.
 * Every command is scoped by the session's user id; guests have no wishlist (they are asked to
 * sign in). Bounded so the header seed and the account page stay small.
 */

export const MAX_WISHLIST_ITEMS = 60;

type Executor = Pick<Database, 'select'>;

/** Product ids of the member's wishlist, most recently added first. */
export async function listWishlistProductIds(db: Executor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ productId: wishlists.productId })
    .from(wishlists)
    .where(eq(wishlists.userId, userId))
    .orderBy(desc(wishlists.createdAt), desc(wishlists.productId))
    .limit(MAX_WISHLIST_ITEMS);
  return rows.map((row) => row.productId);
}

/**
 * Adds or removes one product. Adding an unknown, deleted or archived product is refused;
 * adding beyond the cap is `invalid` (`wishlistFull`). Idempotent in both directions.
 */
export async function setWishlisted(
  db: Database,
  input: { userId: string; productId: string; wishlisted: boolean },
): Promise<{ wishlisted: boolean }> {
  if (!input.wishlisted) {
    await db
      .delete(wishlists)
      .where(and(eq(wishlists.userId, input.userId), eq(wishlists.productId, input.productId)));
    return { wishlisted: false };
  }
  return db.transaction(async (tx) => {
    // Serializes concurrent adds of the same member so the cap holds.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`wishlist:${input.userId}`}, 0))`,
    );
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.status, 'active'),
          sql`${products.deletedAt} is null`,
        ),
      );
    if (!product) throw new DomainError('notFound');
    const [existing] = await tx
      .select({ productId: wishlists.productId })
      .from(wishlists)
      .where(and(eq(wishlists.userId, input.userId), eq(wishlists.productId, input.productId)));
    if (existing) return { wishlisted: true };
    const [total] = await tx
      .select({ n: count() })
      .from(wishlists)
      .where(eq(wishlists.userId, input.userId));
    if ((total?.n ?? 0) >= MAX_WISHLIST_ITEMS) {
      throw new DomainError('invalid', [{ path: 'productId', code: 'wishlistFull' }]);
    }
    await tx
      .insert(wishlists)
      .values({ userId: input.userId, productId: input.productId })
      .onConflictDoNothing();
    return { wishlisted: true };
  });
}
