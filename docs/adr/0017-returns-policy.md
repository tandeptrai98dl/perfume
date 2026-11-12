# ADR-0017: Returns policy

- Status: Accepted — lawyer reviews the wording
- Date: 2026-11-11
- Decision ID: D17

## Context

Perfume is a cosmetic; opened products cannot be resold. The policy must protect customers and the business.

## Decision

Returns accepted within 7 days of delivery if the seal is intact. Defective, wrong or broken items are replaced or refunded 100% and the shop pays shipping. Opened items are not returnable except for defects.

## Consequences

- Order states `return_requested` → `returned`; refunds recorded in `refunds`.
- Return request form with reason and photos.
- Policy published in Vietnamese and English; Vietnamese prevails.
- *Implementation note (M3 wave 2):* the window is the `returns.windowDays` setting (default 7) from `delivered_at`. One request per order; the request and every decision are `order_events` (no `return_requests` table yet). A partial return keeps the order `delivered` (only `returned` exists for whole orders) and restocks/refunds just the returned lines; returned units are written off as `damage` unless staff mark them resellable. For the shop's fault the refund adds the return shipping the customer paid and, when everything comes back, the original shipping and gift-wrap fees. Photos are collected by the shop on request until a private upload pipeline exists. Details: ARCHITECTURE.md §3.5 "Returns as implemented".

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
