# Development plan and status

> Living status of the MVP delivery plan. The plan itself (scope, exit criteria, go-live gate)
> is [ARCHITECTURE.md §15](./ARCHITECTURE.md#15-delivery-plan); this file tracks progress against it.
> Last updated: 2026-11-12 (M3 wave 2 integrated).

## Milestones

| Milestone | Scope (§15) | Status | Merged in | Exit criteria |
| --- | --- | --- | --- | --- |
| M0 Foundations | Scaffold, i18n, DB + seed, Better Auth + 2FA, design system, worker + outbox, CI, Sentry | **Done** | #1, #2, #3 | Met. Staging deploy is still open and is tracked in M3. |
| M1 Bilingual catalogue & storefront | Admin catalogue/inventory/media, storefront pages, search, CMS, redirects, SEO | **Done** | #4, #5 | Met. Lighthouse and Rich Results checks are carried into M3 hardening. |
| M2 Checkout & orders | Cart, checkout, VNPay/payOS/COD, admin orders (manual orders, edits), account, notifications | **Done** (E5 partial) | #6, #7, #8, #9 | [m2-exit.md](./milestones/m2-exit.md). Only E5 is open: a manual order on staging, which needs the staging environment. |
| M3 Completion, hardening, go-live | See below | **In progress**: code waves 1–2 done | #10 (foundation), wave 1 PR | Go-live gate in §15 |

## M3 work streams

The foundation (migration `0005`: reviews, review invitations, notification logs, rate limits) is merged.
The streams below run in parallel and are integrated together.

| Stream | Scope | Status |
| --- | --- | --- |
| Reviews & wishlist | Verified reviews (members + guest token link, ADR-0008), moderation `/admin/reviews`, AggregateRating, wishlist | **Done** |
| Admin | KPI dashboard, staff management, audit log viewer (`/admin/audit-log`), permission review + coverage test | **Done** |
| Privacy & legal | Cookie consent + consent log, consent-gated GTM, privacy centre, guest requests, admin privacy requests, anonymisation, policy drafts vi + en, footer badge slot | **Done** |
| E-invoicing & notifications | E-invoice adapters (MISA / Viettel / sandbox) issued on `delivered` with retries and staff alerts, notification log, M2 follow-ups | **Done** |
| Hardening & ops | CSP without nonces (ADR-0024), security headers, shared Postgres rate limits, trusted client IP, Turnstile, webhook IP allowlist, Lighthouse/ZAP/k6, backups, runbook, health endpoints | **Done** |

### M3 wave 2 (done)

| Stream | Scope | Status |
| --- | --- | --- |
| Customers & alerts | `/admin/customers` (list, detail, COD risk flag, notes in `customer_notes` per ADR-0025, CSV export), low-stock / failed-job / pending-review alerts | **Done** |
| Settings & seed | `/admin/settings` (seller + MOIT, checkout & COD, returns, VAT, alert channels, SEO defaults, sender), legal pages in the production seed | **Done** |
| Home & newsletter | New arrivals, best sellers, journal teaser, trust strip; newsletter double opt-in + one-click unsubscribe; keyboard-only purchase, SEO alternates and axe E2E | **Done** |
| Quality gates | Lighthouse CI on every PR (mobile + desktop, Performance ≥ 0.9), PDP JS budget (ADR-0026), weekly ZAP baseline, performance fixes (LCP ~1 s, CLS ≤ 0.01) | **Done** |
| Returns & e-invoice adjustments | Customer return requests (D17), admin return flow with restock/refund/replacement, e-invoice cancel/replace | **Done** |

### Remaining before go-live (code)

- ~~Return photo upload (needs private storage); staff-opened returns.~~ Done in M3 wave 3 (ADR-0027).
- ~~COD orders fully returned before the carrier remits: reconcile them in COD remittances instead of a manual refund.~~ Done in M3 wave 3 (deferred refunds).
- Review the ZAP "Private IP Disclosure" warning on the privacy policy pages (likely a false positive).
- Re-measure Lighthouse with real product images once content exists.

After the streams are merged, these items need production accounts:
- production infrastructure and staging
- VNPay/payOS production keys
- domain and email (SPF/DKIM/DMARC)
- Search Console

After that come UAT, the soft launch and go-live (§15 items 4–6).

## Business track (owner: project owner, outside the code)

The code is ready to take these through settings and environment variables.

- [ ] VNPay merchant contract, payOS registration
- [ ] Vietnam cloud provider, domain, business email
- [ ] Lawyer approves policies (vi + en) and D12/D15/D17
- [ ] E-invoice provider contract; accountant confirms template/series and VAT rates (D13)
- [ ] Product photos and Vietnamese copy (first 50–100 products); English content editor
- [ ] Final GHN shipping rates; COD and returns settings (D16/D17)
- [ ] E-commerce website notification (Bộ Công Thương) before go-live
