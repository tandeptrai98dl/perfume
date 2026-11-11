# ADR-0002: Bilingual storefront (Vietnamese + English) from MVP

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D02

## Context

A meaningful share of luxury perfume buyers in Vietnam are foreigners living in or visiting the country. The operations team is Vietnamese.

## Decision

The storefront supports Vietnamese (default) and English from the first release: UI, catalogue and journal content, policy pages, transactional emails, localized URLs and hreflang. The admin UI is Vietnamese only in MVP; admins edit content translations in vi/en tabs.

## Consequences

- Translatable content needs translation tables (ADR-0011) and an editorial workflow (ADR-0021).
- About two extra weeks in the plan (ADR-0014).
- Every user-facing string goes through next-intl; CI enforces key parity between `messages/vi.json` and `messages/en.json`.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
