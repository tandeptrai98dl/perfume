# ADR-0005: Separate order status and payment status

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D05

## Context

With COD, deposits and partial refunds, the movement of goods and the movement of money are independent. A single status field cannot represent states such as 'delivered but COD not yet remitted' or 'confirmed with deposit paid'.

## Decision

`orders.status` tracks only the fulfilment lifecycle and is changed exclusively through `transitionOrder()` in the order module. `orders.payment_status` (`unpaid`, `partially_paid`, `paid`, `partially_refunded`, `refunded`) is changed only by the payment module (verified IPN/webhook, COD remittance, refund). Orders store `amount_paid`, `amount_refunded` and a generated `amount_due`. Every change writes an `order_events` row.

## Consequences

- Transition tables for both state machines are unit-tested.
- Dashboards and filters can combine both dimensions.
- See ARCHITECTURE.md section 3.5 for the full transition table.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
