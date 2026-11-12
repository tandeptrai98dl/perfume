import { eq } from 'drizzle-orm';

import { products } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

/**
 * Denormalized rating of a product (`products.rating_avg`, `rating_count`, §6.2), written only
 * here (catalogue owns `products`). The review module calls it in its moderation transaction
 * with the aggregates of the approved reviews, so listings and the Product JSON-LD stay in
 * step with what is published.
 */
export async function setProductRating(
  tx: Pick<Tx, 'update'>,
  productId: string,
  rating: { average: number; count: number },
): Promise<void> {
  await tx
    .update(products)
    .set({
      ratingAvg: rating.count > 0 ? rating.average : 0,
      ratingCount: rating.count,
    })
    .where(eq(products.id, productId));
}
