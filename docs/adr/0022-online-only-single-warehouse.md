# ADR-0022: Online-only sales from a single warehouse

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D22

## Context

Selling through physical stores or marketplaces requires real-time stock synchronization across channels.

## Decision

MVP sells online only from one warehouse (one `locations` row). Physical store / POS and marketplace sync are Phase 3 and will use `locations` and `inventory_items` per location.

## Consequences

- No multi-channel stock sync in MVP.
- Schema is already multi-location ready.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
