# ADR-0023: Worker build, transactional outbox and internal revalidation

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D23 (M0 spike; refines the "Background jobs" row of ARCHITECTURE.md §4.1)

## Context

ARCHITECTURE.md planned three things to validate in an M0 spike:

1. A pg-boss worker, built with tsup **using the `react-server` condition**, that imports the
   same `server/` code as the Next.js app.
2. A transactional outbox: jobs enqueued inside the Drizzle transaction of the business change.
3. Cache revalidation from the worker through an HMAC-signed internal endpoint.

## Findings

- **The `react-server` condition breaks the worker.** With `--conditions=react-server`:
  - `react-dom/server` throws ("not supported in React Server Components"), so React Email
    cannot render any template;
  - `next-intl` resolves to its RSC build, which imports `next/headers` and fails outside Next.js.
  The only benefit of the condition was turning `server-only` into a no-op.
- **pg-boss 12 ships a Drizzle adapter.** `fromDrizzle(tx, sql)` passed as the `db` option of
  `send()` runs the insert on the transaction's connection. Verified by integration tests:
  rollback leaves no job, commit leaves exactly one, and a worker then completes it.
- Producers need a started pg-boss instance; with `supervise: false, schedule: false` it does no
  maintenance work, so the web app can hold a small producer pool (max 3 connections).
- The worker bundle is small (~16 KB of app code) when node_modules stay external.
- Next.js 16 `revalidateTag(tag, profile)` works from a Route Handler; `"max"` gives
  stale-while-revalidate, `{ expire: 0 }` forces the next request to miss.

## Decision

- **Worker build:** tsup bundles `worker/index.ts` and everything under `@/` into
  `dist/worker/index.mjs`; node_modules stay external and resolve with Node's **default**
  conditions. No `react-server` condition, at build time or at runtime. `server-only` is
  aliased to a no-op in the bundle as a safety net only.
- **Shared-code rule (unchanged, now enforced):** `src/server/{modules,jobs,integrations,db,lib}`
  and `worker/` must not import `server-only` or Next.js runtime APIs (`next/headers`,
  `next/cache`, `next/navigation`). ESLint `no-restricted-imports` blocks `server-only` there.
  Localized strings in shared code use `createTranslator` (not request-bound helpers).
- **Outbox API:** `enqueue(boss, tx, name, data, options?)` in `src/server/jobs/queue.ts`.
  Every job is declared in `src/server/jobs/definitions.ts` with a Zod payload schema and a
  retry policy (5 retries, exponential backoff, shared dead-letter queue `system.dead-letter`).
  Payloads are validated when enqueued and again before the handler runs.
- **Queues** are created idempotently (`ensureQueues`) by the worker and by producers on start.
  pg-boss owns its `pgboss` schema and job ids (UUIDv4); ADR-0010 applies to our tables only.
- **Internal revalidation:** `POST /api/internal/revalidate` with body `{ tags, expire }` and
  headers `x-internal-timestamp` + `x-internal-signature: sha256=<hex>` where the signature is
  HMAC-SHA256 over `${timestamp}.${body}` with `INTERNAL_API_SECRET`. Requests older than
  5 minutes are rejected; comparison is constant-time; body capped at 16 KB.
- **Email:** the worker is the only sender. `server/integrations/email/send.ts` renders React
  Email templates (`react-email` package) to HTML + plain text and sends over SMTP
  (`SMTP_URL`; Mailpit in development).

## Consequences

- One rule to remember instead of a build flag: shared server code is plain Node code.
  Next-only helpers live in `src/server/auth/`, `src/actions/` and `src/app/`.
- `pnpm worker:dev` (tsx, watch), `pnpm worker:build` (tsup), `pnpm worker:start`.
  `pnpm jobs:test-email --to <email>` exercises the full outbox path.
- New env: `INTERNAL_API_SECRET` (required in production), `INTERNAL_APP_URL` (worker → web,
  defaults to `APP_URL`), `SMTP_URL`, `EMAIL_FROM`.
- Revalidation is at-least-once: handlers must stay idempotent (revalidating twice is harmless).
- If pg-boss load ever hurts the primary database, ARCHITECTURE.md §14.2 (BullMQ) still applies;
  only `queue.ts` and the runner change.
