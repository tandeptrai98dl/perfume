# ADR-0018: Shipping carriers

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D18

## Context

Integrating several carriers early costs time; one primary carrier simplifies operations and reconciliation.

## Decision

GHN is the primary carrier, GHTK the backup. In MVP staff create shipments in the carrier portal and enter tracking codes manually. Phase 2 integrates the GHN API first (labels, rates, status webhooks, COD reconciliation).

## Consequences

- `shipments.carrier` enum already includes ghn, ghtk, viettel_post.
- Address model keeps an optional legacy district for carriers that still need it.
- Rates in MVP come from zone/weight tables.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
