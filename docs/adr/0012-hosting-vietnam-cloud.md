# ADR-0012: Hosting on a Vietnam-based cloud behind Cloudflare

- Status: Accepted — pending lawyer review before go-live
- Date: 2026-11-11
- Decision ID: D12

## Context

Decree 53/2022/ND-CP places domestic companies that collect data of users in Vietnam under a duty to store that data in Vietnam. Domestic hosting also lowers latency.

## Decision

Host the web app, worker, PostgreSQL and object storage on a Vietnam-based cloud (e.g. VNG Cloud, Viettel Cloud, FPT Cloud, BizFly) with Docker Compose, behind Cloudflare (DNS, CDN, WAF, DDoS, Turnstile). Fallback if the lawyer requires it: Cloudflare in DNS-only mode. Code must not depend on Vercel-specific features.

## Consequences

- Cloudflare, the email provider, Sentry and GA4 are cross-border processors and must be listed in the privacy policy and transfer dossier.
- Next.js runs in `output: 'standalone'` mode; caching must work self-hosted.
- Lawyer confirmation is part of the go-live gate.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
