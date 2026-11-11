# ADR-0006: Payment session and stock reservation timeouts

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D06

## Context

Unpaid orders must not hold stock indefinitely, and gateway payment sessions expire on their own.

## Decision

Online payment sessions expire after 15 minutes; customers may retry (and change method) while the stock reservation is valid. Online orders reserve stock for 30 minutes via `stock_reservations.expires_at`; if unpaid, the order is cancelled and stock released. COD orders awaiting staff confirmation reserve stock for 24 hours and are auto-cancelled if not confirmed. All values are configurable in settings.

## Consequences

- A recurring worker job releases expired reservations and cancels orders.
- IPNs arriving after cancellation are recorded and routed to the refund queue with a staff alert.
- Checkout UI shows a countdown and a 'Retry payment' action.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
