# ADR-0001: Product scope: B2C perfume store for Vietnam

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D01

## Context

We are building an online store for authentic perfumes. The market is Vietnam, prices are in VND, and the business sells directly to consumers from its own website (not a marketplace).

## Decision

Build a B2C e-commerce website selling authentic perfumes from multiple brands (niche and designer) plus fixed gift sets, operated by a Vietnamese company under its own name. Currency is VND only.

## Consequences

- Legal obligations of a seller's own e-commerce website apply (E-commerce Law 122/2025/QH15): seller disclosure, product information, policies, website notification.
- No marketplace features (multi-vendor, seller payouts) are in scope.
- Multi-currency is deferred to Phase 3 (`price_lists`).

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
