# ADR-0021: English content quality and go-live threshold

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D21

## Context

Machine-translated copy damages a luxury brand and ranks poorly.

## Decision

English content is written or reviewed by an English editor. A translation is visible only when `is_published = true`. Go-live requires 100% of active products with Vietnamese content and at least 80% with a published English translation.

## Consequences

- Dashboard shows missing translations.
- Phase 2 may add machine-translation suggestions that a human approves.
- Content track starts English work by week 8.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
