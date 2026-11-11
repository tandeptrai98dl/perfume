# ADR-0010: PostgreSQL 17 with application-generated UUIDv7

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D10

## Context

Managed PostgreSQL offerings from Vietnamese cloud providers may lag the latest major version. PostgreSQL 17 has no built-in `uuidv7()` (added in 18). Time-ordered ids improve index locality.

## Decision

Use PostgreSQL 17. Generate UUIDv7 primary keys in the application via `src/server/lib/ids.ts` (`uuidv7` package). Do not rely on database-generated UUIDs.

## Consequences

- Upgrading to PostgreSQL 18 later is non-breaking.
- Better Auth is configured to use the same id generator.
- Extensions required: `unaccent`, `pg_trgm`, `citext`.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
