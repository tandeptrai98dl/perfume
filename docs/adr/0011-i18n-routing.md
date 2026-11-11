# ADR-0011: Internationalization with next-intl and localized pathnames

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D11

## Context

Vietnamese is the main market and should have the shortest URLs; English pages need their own indexable URLs; code must stay English (ADR-0003).

## Decision

Use next-intl with `localePrefix: 'as-needed'`: Vietnamese without prefix, English under `/en`. Route folders are English and Vietnamese pathnames are mapped in `src/i18n/routing.ts` (e.g. `/perfumes` → `/nuoc-hoa`). `/admin` and `/api` are outside `[locale]`. No automatic redirect on `Accept-Language`; a one-time suggestion banner instead, with the choice stored in the `NEXT_LOCALE` cookie and `users.locale`. Translatable database fields live in `<entity>_translations` tables keyed by `(entity_id, locale)` with per-locale unique slugs and `is_published`.

## Consequences

- hreflang alternates (vi, en, x-default = vi) and per-locale sitemaps.
- Products without a published English translation are hidden on the English storefront.
- Transactional emails use `orders.locale`; VNPay receives `vnp_Locale`.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
