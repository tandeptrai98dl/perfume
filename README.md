# Perfume Store

Bilingual (Vietnamese / English) e-commerce website for authentic perfumes, built for the Vietnamese market.

- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Decisions:** [docs/adr/](docs/adr/README.md) (ADR-0001 … ADR-0027)
- **Status:** [development plan](docs/DEVELOPMENT_PLAN.md) · [security review](docs/security/review-2026-11.md)
- **Operations:** [runbook](docs/ops/runbook.md) · [production checklist](docs/ops/production-checklist.md) · [seeding](docs/ops/seed.md) · [backups and restore drill](docs/ops/backup-restore.md) · [k6 load test](load/k6/README.md)
- **Rules for Claude Code:** [CLAUDE.md](CLAUDE.md)

## Stack

Next.js 16 (App Router) · TypeScript · next-intl · PostgreSQL 17 · Drizzle ORM · Better Auth ·
Tailwind CSS v4 + shadcn/ui · pg-boss · Vitest · Playwright · pnpm · Docker

## Local development

Requirements: Node.js 24 (see `.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env.local
docker compose -f docker/compose.yml up -d   # PostgreSQL 17, Mailpit, MinIO
pnpm db:migrate
pnpm db:seed                                  # base data + fictional demo data (docs/ops/seed.md)
pnpm dev                                      # http://localhost:3000 (vi), /en (English)
```

Admin (`/admin`) needs a staff account. Create the first owner, then sign in at
`/admin/login`; TOTP enrolment is mandatory on first sign-in:

```bash
STAFF_PASSWORD='choose-a-strong-password' pnpm auth:create-staff --email you@example.com --name "Owner" --role owner
```

| Command                                              | Purpose                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                             |
| `pnpm test`                                          | Unit tests (Vitest)                                                       |
| `pnpm test:integration`                              | DB integration tests (Testcontainers, or `TEST_DATABASE_URL`)             |
| `pnpm i18n:check`                                    | vi/en message key parity                                                  |
| `pnpm security:permissions`                          | Regenerate `docs/security/permission-review.md` (`--check` in CI)         |
| `pnpm test:e2e`                                      | Playwright E2E against the production build (see below)                   |
| `pnpm db:generate`                                   | Generate a migration from schema changes                                  |
| `pnpm auth:create-staff`                             | Create or promote a staff account (`owner`, `manager`, `staff`, `editor`) |

Local services: Mailpit UI http://localhost:8025, MinIO console http://localhost:9001.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main`:

- lint, format, types, unit tests, i18n parity, worker bundle, dependency audit
- integration tests against PostgreSQL 17
- Playwright E2E on the production build: desktop 1280 px, mobile 375 px and admin, vi and en, axe WCAG 2.2 AA. The job also runs the PDP JS budget (`scripts/js-budget.mjs`, ADR-0026).
- Docker image builds
- Gitleaks secret scan

`lighthouse.yml` runs Lighthouse CI (mobile + desktop, median of 3, §14 budgets) on every pull request. `zap-baseline.yml` runs the OWASP ZAP baseline weekly and on demand, against a production build started inside the job. Dependabot opens weekly update PRs.

### Running E2E locally

E2E needs the production build and its own freshly seeded database. Playwright starts the standalone server on port 3200 and reads no `.env.local`:

```bash
export DATABASE_URL=postgres://perfume:perfume@localhost:5432/perfume_e2e   # created empty
export BETTER_AUTH_SECRET=<32+ random chars> INTERNAL_API_SECRET=<32+ random chars>
pnpm db:migrate && pnpm db:seed && pnpm build
PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e      # or: pnpm exec playwright install chromium
pnpm test:e2e tests/e2e/admin-returns.spec.ts --project=admin --no-deps   # one admin spec
```

## Docker images

| Image  | Dockerfile                 | Runs                                                                                                         |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| web    | `docker/Dockerfile`        | Next.js standalone server on port 3000, health checks `/api/health`, `/api/health/live`, `/api/health/ready` |
| worker | `docker/Dockerfile.worker` | pg-boss worker; also `node dist/worker/migrate.mjs` and `node dist/worker/seed.mjs`                          |

```bash
docker build -f docker/Dockerfile -t perfume-web .
docker build -f docker/Dockerfile.worker -t perfume-worker .
docker run --rm --env-file .env.production perfume-worker node dist/worker/migrate.mjs
```

Error reporting uses Sentry when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set. Default PII
is off and every event is scrubbed (emails, phone numbers, cookies, auth headers, request
bodies, query values) by `src/lib/observability/scrub.ts`.
