'use client';

import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';

/*
 * Selected variant (SKU) shared by the PDP gallery (cached part of the page) and the variant
 * selector (live price/stock island). The selector owns `?v=`; the gallery only reads the SKU,
 * so the cached part never depends on search params.
 */

type Store = {
  get: () => string | null;
  set: (sku: string | null) => void;
  subscribe: (listener: () => void) => () => void;
  initial: string | null;
};

function createStore(initial: string | null): Store {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    initial,
    get: () => value,
    set: (sku) => {
      if (sku === value) return;
      value = sku;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const VariantContext = createContext<Store | null>(null);

export function ProductVariantProvider({
  defaultSku,
  children,
}: {
  defaultSku: string | null;
  children: ReactNode;
}) {
  const [store] = useState(() => createStore(defaultSku));
  return <VariantContext value={store}>{children}</VariantContext>;
}

export function useSelectedSku(): string | null {
  const store = use(VariantContext);
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.get ?? nullSnapshot,
    () => store?.initial ?? null,
  );
}

export function useSetSelectedSku(): (sku: string | null) => void {
  const store = use(VariantContext);
  return store?.set ?? noop;
}

const noop = () => {};
const noopSubscribe = () => noop;
const nullSnapshot = () => null;
