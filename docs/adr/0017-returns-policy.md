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

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
