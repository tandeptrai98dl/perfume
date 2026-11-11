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

| Command | Purpose |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | DB integration tests (Testcontainers, or `TEST_DATABASE_URL`) |
| `pnpm i18n:check` | vi/en message key parity |
| `pnpm db:generate` | Generate a migration from schema changes |

Local services: Mailpit UI http://localhost:8025, MinIO console http://localhost:9001.
