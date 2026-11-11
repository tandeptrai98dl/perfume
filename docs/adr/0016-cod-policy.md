# ADR-0016: Cash-on-delivery policy

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D16

## Context

COD is the preferred payment method for many Vietnamese buyers, but failed deliveries on high-value orders are costly.

## Decision

Offer COD nationwide. Orders up to 5,000,000 VND require no deposit; above that, a 20% deposit is paid online (VietQR/VNPay) before the order is confirmed and the carrier collects the balance. Threshold and deposit percentage are configurable in settings. Phone numbers with failed deliveries are flagged.

## Consequences

- Payment kind `deposit` and `payment_status = partially_paid`.
- Staff confirm COD orders within 24 hours (ADR-0006).
- COD remittances are reconciled manually in MVP (ADR-0009).

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
