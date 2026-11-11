'use client';

import { useEffect, useSyncExternalStore, type ComponentProps } from 'react';

import type { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/*
 * Equivalent page in each locale for the LanguageSwitcher (§10.7). Pages whose slugs differ
 * per locale (products, brands, categories, …) render <SetLocaleAlternates> with the target
 * href per locale; pages without one fall back to the current pathname and params.
 * A tiny external store (one per tab) instead of context, so it works across the header and
 * the page without wrapping the layout.
 */

export type LocaleHref = ComponentProps<typeof Link>['href'];
export type LocaleAlternates = Partial<Record<Locale, LocaleHref>>;

let current: LocaleAlternates | null = null;
const listeners = new Set<() => void>();

function publish(next: LocaleAlternates | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocaleAlternates(): LocaleAlternates | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Renders nothing; registers the alternates while the page is mounted. */
export function SetLocaleAlternates({ alternates }: { alternates: LocaleAlternates }) {
  const key = JSON.stringify(alternates);
  useEffect(() => {
    publish(JSON.parse(key) as LocaleAlternates);
    return () => publish(null);
  }, [key]);
  return null;
}
