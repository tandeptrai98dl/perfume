'use client';

import { create } from 'zustand';

/**
 * Mini-cart client state (CLAUDE.md: Zustand for the mini-cart only): whether the sheet is
 * open and the header badge count. Cart contents always come from the server.
 */
type MiniCartState = {
  open: boolean;
  /** Units in the cart; null until the server count has been seen. */
  count: number | null;
  setOpen: (open: boolean) => void;
  setCount: (count: number) => void;
};

export const useMiniCart = create<MiniCartState>()((set) => ({
  open: false,
  count: null,
  setOpen: (open) => set({ open }),
  setCount: (count) => set({ count }),
}));
