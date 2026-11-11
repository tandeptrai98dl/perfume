# ADR-0020: Single domain for both languages

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D20

## Context

Separate domains per language split SEO authority and add certificates and analytics properties.

## Decision

Use one domain; English is served under `/en`.

## Consequences

- One Search Console property and one TLS certificate.
- hreflang links vi and en versions on the same domain.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
