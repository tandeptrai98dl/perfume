import { WishlistSeed } from '@/components/shop/wishlist-seed';
import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { listWishlistProductIds } from '@/server/modules/customer';

/**
 * Dynamic hole of the shop layout (reads the session): seeds the wishlist hearts of cached
 * pages. Re-renders after every wishlist Server Action (`refresh()`).
 */
export async function WishlistIds() {
  const session = await getCustomerSession();
  const ids = session ? await listWishlistProductIds(getDb(), session.user.id) : [];
  return <WishlistSeed signedIn={Boolean(session)} ids={ids} />;
}
