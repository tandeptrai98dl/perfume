'use client';

import { useEffect } from 'react';

import { seedWishlist } from './wishlist-store';

/** Rendered by the shop layout's dynamic hole: pushes the member's wishlist to the store. */
export function WishlistSeed({ signedIn, ids }: { signedIn: boolean; ids: string[] }) {
  const key = ids.join(',');
  useEffect(() => {
    seedWishlist({ signedIn, ids: key ? key.split(',') : [] });
  }, [signedIn, key]);
  return null;
}
