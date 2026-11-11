# Perfume Store — Claude Code guide

## Source of truth
- Architecture: `docs/ARCHITECTURE.md`. Decisions: `docs/adr/` (ADR-0001 … ADR-0022 = D01 … D22).
- If the code, a prompt and an ADR disagree, the ADR wins.
- Do not change the stack, add a major dependency, or change the schema shape outside
  the task scope. Ask first and propose a new ADR (copy `docs/adr/0000-template.md`).

## Workflow
- Work on one small task at a time. Plan first: list the files you will create or change
  and wait for approval before writing code.
- Keep diffs focused; no drive-by refactors.
- Commit messages follow Conventional Commits (`feat(order): ...`, `fix(payment): ...`).

## Language rules (ADR-0003)
- Everything in the repo is English: file/folder names, route folders, identifiers,
  DB tables/columns/enums, comments, commit messages, PR descriptions, docs, prompts.
- Vietnamese appears only as user-facing content: `messages/vi.json`, DB content,
  and localized URL pathnames in `src/i18n/routing.ts`.
- Never hard-code user-facing text in components. Use next-intl
  (`useTranslations` / `getTranslations`) with English namespaced keys, e.g. `checkout.placeOrder`.
  Every key must exist in both `messages/vi.json` and `messages/en.json` (`pnpm i18n:check`).
- Admin UI strings live in the `admin` namespace (Vietnamese only in MVP).

## Stack
Next.js 16 App Router (Turbopack), TypeScript strict, Node 24, next-intl,
Drizzle ORM + PostgreSQL 17, Better Auth, Tailwind CSS v4 + shadcn/ui, Zod v4,
React Hook Form, nuqs, Zustand (mini-cart only), TanStack Table, Tiptap, Motion,
pg-boss (worker), React Email, Vitest, Testcontainers, Playwright, MSW, pnpm.

## Commands
```
pnpm dev            pnpm build          pnpm lint           pnpm typecheck
pnpm test           pnpm test:e2e       pnpm i18n:check     pnpm worker:dev
pnpm db:generate    pnpm db:migrate     pnpm db:seed
```

## Architecture rules
- Modular monolith. Business logic lives only in `src/server/modules/<module>/`
  (`index.ts` public API, `service.ts`, `repo.ts`, `schemas.ts`, `types.ts`).
- `app/` and `actions/` call a module's `index.ts`, never another module's `repo.ts`.
  Only the owning module writes to its tables.
- Side effects (emails, Telegram alerts, e-invoices, revalidation from the worker) go
  through pg-boss jobs enqueued in the same DB transaction (transactional outbox).
- Do not import `server-only` inside `server/modules` (the worker shares them);
  use it only in Next-only files (`actions/`, `server/auth/`).
- Integrations sit behind adapters in `src/server/integrations/*`.

## Code rules
- Server Components by default; add `'use client'` only for interactivity.
- Every Server Action and Route Handler starts with Zod validation and a permission
  check (`requirePermission`). `/admin` also requires a `two_factor_verified` session.
- Money is `bigint` VND. Never use floats. Always recompute prices on the server.
- Order status changes only through `transitionOrder()`. Payment status changes only in
  the payment module (verified IPN/webhook, COD remittance, refund) (ADR-0005).
- Webhooks: verify signature, match amount and `txn_ref`, enforce idempotency; return URLs
  never change state.
- Stock changes run in a transaction with `SELECT ... FOR UPDATE` and write a
  `stock_movements` row. Reservations use `stock_reservations.expires_at` (ADR-0006).
- Translatable content lives in `*_translations` tables keyed by `(entity_id, locale)`.
  Vietnamese is required; English shows only when `is_published = true` (ADR-0011, ADR-0021).
- Generate ids with `src/server/lib/ids.ts` (UUIDv7). Do not rely on DB-generated UUIDs (ADR-0010).
- Use design tokens from `globals.css`; no hard-coded colours, font sizes or radii.
- Never log PII (phone, email, address) in plain text. Payment secrets come from env only (ADR-0007).
- Decants are not sold in MVP (ADR-0015); do not expose `variant_type = 'decant'` in UI.

## Definition of Done
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` pass.
- New service logic has unit tests; DB-heavy logic has integration tests (Testcontainers).
- E2E added or updated when the purchase flow is touched — run in both `vi` and `en`.
- Migrations run cleanly on an empty database; seed updated if needed.
- No console errors; works at 375 / 768 / 1280 px; keyboard accessible; axe clean.
- Docs/ADRs updated when behaviour changes.
