import { routing, type Locale } from '@/i18n/routing';

/** Slugs of one entity per locale; `published` means visible in that locale right now. */
export type LocalizedSlugs = Partial<Record<Locale, { slug: string; published: boolean }>>;

/**
 * Paths the language switcher can produce when it keeps one locale's slug in another locale
 * (e.g. `/en/products/<vi-slug>`), mapped to the equivalent page, or to the closest listing
 * when the entity has no published translation there (ARCHITECTURE.md §10.7).
 * Shared by the content and catalogue route tables.
 */
export function localeFallbacks(
  entities: { slugs: LocalizedSlugs }[],
  path: (slug: string, locale: Locale) => string,
  listing: (locale: Locale) => string,
): { path: string; toPath: string }[] {
  const out: { path: string; toPath: string }[] = [];
  for (const entity of entities) {
    for (const source of routing.locales) {
      const from = entity.slugs[source];
      if (!from?.published) continue;
      for (const target of routing.locales) {
        if (target === source) continue;
        const wrong = path(from.slug, target);
        const to = entity.slugs[target];
        const real = to ? path(to.slug, target) : null;
        if (wrong === real && to?.published) continue;
        out.push({ path: wrong, toPath: to?.published ? real! : listing(target) });
      }
    }
  }
  return out;
}
