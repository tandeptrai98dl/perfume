# ADR-0009: Operational features included in MVP

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D09

## Context

In Vietnam many orders arrive by phone or Zalo, customers often change addresses, COD money is remitted by carriers in batches, and data-subject requests have legal deadlines.

## Decision

The MVP includes: manual order creation by staff, order edits before shipping (with optimistic locking and payment/refund of differences), internal staff alerts, COD remittance reconciliation, and a minimal privacy-request screen.

## Consequences

- Adds `orders.source`, `orders.created_by`, `orders.version`, `cod_remittances`, `cod_remittance_orders`, `privacy_requests`, `notification_logs`.
- About two extra weeks in the plan (ADR-0014).
- Staff stop working outside the system, so stock and money stay consistent.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
