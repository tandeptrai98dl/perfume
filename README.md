# Perfume Store

Bilingual (Vietnamese / English) e-commerce website for authentic perfumes, built for the Vietnamese market.

- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Decisions:** [docs/adr/](docs/adr/README.md) (ADR-0001 … ADR-0022)
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
pnpm db:seed                                  # admin units + fictional demo catalogue
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
| `pnpm db:generate`                                   | Generate a migration from schema changes                                  |
| `pnpm auth:create-staff`                             | Create or promote a staff account (`owner`, `manager`, `staff`, `editor`) |

Local services: Mailpit UI http://localhost:8025, MinIO console http://localhost:9001.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main`: lint, format, types,
unit tests, i18n parity, worker bundle, dependency audit; integration tests against
PostgreSQL 17; Playwright E2E (desktop 1280 px and mobile 375 px, vi and en, axe WCAG 2.2 AA);
Docker image builds; Gitleaks secret scan. Dependabot opens weekly update PRs.

## Docker images

| Image  | Dockerfile                 | Runs                                                                                |
| ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| web    | `docker/Dockerfile`        | Next.js standalone server on port 3000, health check `/api/health`                  |
| worker | `docker/Dockerfile.worker` | pg-boss worker; also `node dist/worker/migrate.mjs` and `node dist/worker/seed.mjs` |

```bash
docker build -f docker/Dockerfile -t perfume-web .
docker build -f docker/Dockerfile.worker -t perfume-worker .
docker run --rm --env-file .env.production perfume-worker node dist/worker/migrate.mjs
```

Error reporting uses Sentry when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set. Default PII
is off and every event is scrubbed (emails, phone numbers, cookies, auth headers, request
bodies, query values) by `src/lib/observability/scrub.ts`.
