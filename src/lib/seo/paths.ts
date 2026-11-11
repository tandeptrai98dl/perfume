import { routing, type AppPathname, type Locale } from '@/i18n/routing';

/**
 * Locale-aware public paths without Next.js runtime APIs, so server modules, the worker, the
 * proxy and sitemaps can build the same URLs as next-intl's `getPathname` (ADR-0011:
 * Vietnamese without prefix, English under /en, localized pathnames from `routing.ts`).
 */

type Params = Record<string, string>;

function template(pathname: AppPathname, locale: Locale): string {
  const entry = routing.pathnames[pathname] as string | Record<Locale, string>;
  return typeof entry === 'string' ? entry : entry[locale];
}

function prefix(locale: Locale): string {
  return locale === routing.defaultLocale ? '' : `/${locale}`;
}

/** `localizedPath('en', '/journal/[slug]', { slug: 'x' })` → `/en/journal/x`. */
export function localizedPath(locale: Locale, pathname: AppPathname, params: Params = {}): string {
  const filled = template(pathname, locale).replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') throw new Error(`Missing param "${name}"`);
    return encodeURIComponent(value);
  });
  if (filled === '/') return prefix(locale) || '/';
  return `${prefix(locale)}${filled}`;
}

/** Joins a public path with the site origin (no trailing slash on the origin). */
export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export type MatchedPath = { locale: Locale; pathname: AppPathname; params: Params };

type Matcher = { locale: Locale; pathname: AppPathname; regex: RegExp; names: string[] };

let matchers: Matcher[] | undefined;

function buildMatchers(): Matcher[] {
  const out: Matcher[] = [];
  for (const locale of routing.locales) {
    for (const pathname of Object.keys(routing.pathnames) as AppPathname[]) {
      const names: string[] = [];
      const pattern = template(pathname, locale)
        .split('/')
        .map((segment) => {
          const dynamic = /^\[([^\]]+)\]$/.exec(segment);
          if (dynamic) {
            names.push(dynamic[1]!);
            return '([^/]+)';
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
      const full = pattern === '/' || pattern === '' ? '' : pattern;
      out.push({
        locale,
        pathname,
        names,
        regex: new RegExp(`^${prefix(locale)}${full}$`),
      });
    }
  }
  // Static segments win over dynamic ones (e.g. /journal/topics/x before /journal/[slug]).
  return out.sort((a, b) => a.names.length - b.names.length);
}

/**
 * Reverse of `localizedPath`: which route and locale a public pathname belongs to.
 * Returns null for paths that are not localized storefront routes.
 */
export function matchLocalizedPath(path: string): MatchedPath | null {
  matchers ??= buildMatchers();
  const normalized = path === '/' ? '' : path.replace(/\/+$/, '');
  for (const m of matchers) {
    const result = m.regex.exec(normalized);
    if (!result) continue;
    const params: Params = {};
    try {
      m.names.forEach((name, i) => (params[name] = decodeURIComponent(result[i + 1]!)));
    } catch {
      return null;
    }
    return { locale: m.locale, pathname: m.pathname, params };
  }
  return null;
}
