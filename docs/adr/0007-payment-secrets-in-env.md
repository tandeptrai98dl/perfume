# ADR-0007: Payment secrets only in environment/secret store

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D07

## Context

Storing gateway credentials in the database or making them editable in admin increases the attack surface (SQL injection, admin takeover) for a rarely needed convenience.

## Decision

VNPay, payOS and other provider secrets live only in server environment variables or the hosting secret store, validated by Zod at boot. They are never stored in the database, never displayed, and never editable in admin. Rotation is a deploy-time operation documented in the runbook.

## Consequences

- `settings` never contains secrets.
- Gitleaks runs in CI; `.env` is never committed.
- Key rotation requires a redeploy.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
