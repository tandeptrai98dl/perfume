# ADR-0015: No decant sales in MVP

- Status: Accepted — reopen after legal approval
- Date: 2026-11-11
- Decision ID: D15

## Context

Selling decants (perfume repackaged into small vials) may conflict with cosmetic labelling rules and requires tracking partially used bottles.

## Decision

Do not sell decants in MVP. Keep `variant_type = 'decant'` in the schema so the feature can be enabled later without migration.

## Consequences

- Admin does not offer the decant type until enabled.
- Travel sizes and testers from brands are allowed.
- If reopened, add 'open bottle' inventory handling first.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
