# Architecture Decision Records

Format: Context → Decision → Consequences. One file per decision; never edit an accepted
decision silently — supersede it with a new ADR and link both ways.

Template for new ADRs: copy `0000-template.md`, take the next number.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-product-scope.md) | Product scope: B2C perfume store for Vietnam | Accepted |
| [0002](./0002-bilingual-storefront.md) | Bilingual storefront (Vietnamese + English) from MVP | Accepted |
| [0003](./0003-english-only-codebase.md) | English-only codebase and project artefacts | Accepted |
| [0004](./0004-product-per-concentration.md) | One product per concentration, grouped by product lines | Accepted |
| [0005](./0005-order-and-payment-status.md) | Separate order status and payment status | Accepted |
| [0006](./0006-payment-and-reservation-timeouts.md) | Payment session and stock reservation timeouts | Accepted |
| [0007](./0007-payment-secrets-in-env.md) | Payment secrets only in environment/secret store | Accepted |
| [0008](./0008-verified-reviews.md) | Verified reviews for members and guests | Accepted |
| [0009](./0009-operational-features-in-mvp.md) | Operational features included in MVP | Accepted |
| [0010](./0010-postgres-17-uuidv7.md) | PostgreSQL 17 with application-generated UUIDv7 | Accepted |
| [0011](./0011-i18n-routing.md) | Internationalization with next-intl and localized pathnames | Accepted |
| [0012](./0012-hosting-vietnam-cloud.md) | Hosting on a Vietnam-based cloud behind Cloudflare | Accepted — pending lawyer review before go-live |
| [0013](./0013-e-invoicing.md) | Automatic e-invoice for every order | Accepted — pending accountant confirmation of timing and template |
| [0014](./0014-delivery-timeline.md) | Delivery timeline: go-live at end of week 18 | Accepted |
| [0015](./0015-no-decants-in-mvp.md) | No decant sales in MVP | Accepted — reopen after legal approval |
| [0016](./0016-cod-policy.md) | Cash-on-delivery policy | Accepted |
| [0017](./0017-returns-policy.md) | Returns policy | Accepted — lawyer reviews the wording |
| [0018](./0018-shipping-carriers.md) | Shipping carriers | Accepted |
| [0019](./0019-internal-notifications.md) | Internal staff notifications via Telegram | Accepted |
| [0020](./0020-single-domain.md) | Single domain for both languages | Accepted |
| [0021](./0021-english-content-quality.md) | English content quality and go-live threshold | Accepted |
| [0022](./0022-online-only-single-warehouse.md) | Online-only sales from a single warehouse | Accepted |
| [0023](./0023-worker-build-and-outbox.md) | Worker build, transactional outbox and internal revalidation | Accepted |
| [0024](./0024-csp-without-nonces.md) | Content Security Policy without nonces under Cache Components | Accepted |
