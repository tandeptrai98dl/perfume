import { CartCountSeed } from '@/components/shop/cart-link';
import { getCurrentCartCount } from '@/server/cart-session';

/**
 * Dynamic hole of the shop layout (reads the cart cookie/session): seeds the header badge.
 * Re-renders after every cart Server Action (`refresh()`).
 */
export async function CartCount() {
  const count = await getCurrentCartCount();
  return <CartCountSeed count={count} />;
}
