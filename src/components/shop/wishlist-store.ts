'use client';

import { useSyncExternalStore } from 'react';

/**
 * Wishlist hearts' client state (§8.3): whether the visitor is signed in and which products
 * are wishlisted. Seeded by `WishlistSeed` (the shop layout's dynamic hole, re-rendered after
 * every wishlist action), so cached listing pages stay identical for every visitor. A tiny
 * external store instead of Zustand (CLAUDE.md: Zustand is for the mini-cart only).
 */

export type WishlistState = {
  /** False until the server seed arrived (hearts render neutral meanwhile). */
  ready: boolean;
  signedIn: boolean;
  ids: ReadonlySet<string>;
};

const INITIAL: WishlistState = { ready: false, signedIn: false, ids: new Set() };

let state: WishlistState = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function seedWishlist(next: { signedIn: boolean; ids: readonly string[] }) {
  state = { ready: true, signedIn: next.signedIn, ids: new Set(next.ids) };
  emit();
}

/** Optimistic update while the Server Action runs (the seed confirms it afterwards). */
export function markWishlisted(productId: string, wishlisted: boolean) {
  const ids = new Set(state.ids);
  if (wishlisted) ids.add(productId);
  else ids.delete(productId);
  state = { ...state, ids };
  emit();
}

export function useWishlist(): WishlistState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}
