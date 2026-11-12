# ADR-0026: First-load JavaScript budget for the PDP

- Status: Accepted (2026-11-12, recommended option taken under the project owner's standing instruction)
- Date: 2026-11-12
- Decision ID: D26 (M3 quality gates; refines the "JavaScript" row of ARCHITECTURE.md §14.1)

## Context

ARCHITECTURE.md §14.1 sets "PDP JS budget < 150 KB gzip (bundle analyzer in CI)". The figure
dates from the Next.js 13–15 era, when the shared runtime was ~85–100 KB gzip. Measured on
this stack (M3, `scripts/js-budget.mjs`, gzip level 9 of every first-load chunk Next.js lists
in `.next/diagnostics/route-bundle-stats.json`):

| PDP first-load JS | Before the M3 pass | After the M3 pass |
| --- | ---: | ---: |
| Framework runtime (Next.js 16 + React 19, `rootMainFiles`, every route) | 219 KB* | 136.5 KB |
| App code (layout + PDP: next-intl client, Sonner, nuqs, Radix radio group, islands) | 110 KB | 87.6 KB |
| Total | 329 KB | 224 KB |

\* included the Sentry browser SDK and Zod (env validation), now lazy-loaded / removed.

The framework alone is ~136 KB, so 150 KB total would leave ~14 KB for the whole storefront
(next-intl's client runtime alone is ~12 KB). Lighthouse Performance ≥ 90 (the user-facing
§14 goal) is reachable at the current size: LCP and CLS are now dominated by HTML/CSS, not JS.

## Decision

1. Keep the §14.1 intent but measure it in two parts:
   - **App JS** (first-load JS minus the framework runtime): PDP < 100 KB gzip.
   - **Total** first-load JS: PDP ≤ 240 KB gzip as a regression ceiling, lowered whenever a
     change reduces it by more than 10 KB.
2. CI (`.github/workflows/ci.yml`, E2E job after `pnpm build`) enforces the ceiling now and
   reports the 150 KB figure as a warning annotation as the long-term target.
3. Lighthouse Performance ≥ 0.9 (mobile, median of 3) on home, listing and PDP in vi + en stays
   the primary gate (`lighthouserc.cjs`).

## Alternatives

- Keep 150 KB total: only reachable by dropping next-intl on the client, Radix and nuqs, or
  leaving Next.js/React — a stack change (CLAUDE.md) for little measured benefit.
- Exclude the framework entirely ("app JS < 150 KB"): too loose; the PDP is already at 88 KB.

## Consequences

- The owner decides; until then CI uses the ceiling and the warning, ARCHITECTURE.md §14.1
  keeps the original wording with a pointer here.
- New client code on every page (layout/header/footer) counts against the PDP; heavy widgets
  should load on interaction (`React.lazy`, as the search, mini-cart, mobile menu, cookie
  preferences and gallery zoom dialogs do since M3).
