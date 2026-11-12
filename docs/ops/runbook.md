# Operations runbook

For the on-call owner of Perfume Store (one VM on a Vietnam-based cloud behind Cloudflare,
ARCHITECTURE.md §4.2). Companion documents:
[production checklist](./production-checklist.md) · [backups and restore drill](./backup-restore.md) ·
[k6 load test](../../load/k6/README.md).

## 1. System at a glance

| Part | Where | Health |
| --- | --- | --- |
| Cloudflare | DNS (proxied), CDN, WAF, bot fight mode, Turnstile | Cloudflare dashboard → Analytics / Security events |
| Caddy | `docker/compose.prod.yml` service `caddy`, `docker/Caddyfile` | `docker compose ps`, `docker compose logs caddy` |
| web | Next.js standalone (`docker/Dockerfile`) | `/api/health/live` (process), `/api/health` = `/api/health/ready` (database) |
| worker | pg-boss (`docker/Dockerfile.worker`): e-mails, alerts, expiry jobs, e-invoices, revalidation | `docker compose logs worker`; job tables in schema `pgboss` |
| PostgreSQL 17 | provider managed instance, daily snapshots + PITR 14 days | provider console; `select 1` |
| Object storage | provider S3 (media) + separate backup bucket | provider console |
| Errors | Sentry (PII scrubbed), Telegram/e-mail staff alerts (ADR-0019) | Sentry issues, Telegram group |

Client IP: Cloudflare sets `CF-Connecting-IP`; Caddy trusts it only from Cloudflare ranges and
overwrites `X-Client-IP` with `{client_ip}`; the app reads only `TRUSTED_IP_HEADER=x-client-ip`
(rate limits, Turnstile, gateway allowlist, audit logs). The VM firewall must admit 80/443 only
from Cloudflare's ranges (and SSH from the admin IPs).

## 2. Deploy

CI builds and tests every merge to `main` (`.github/workflows/ci.yml`). A release is an image
pair tagged with the commit SHA.

1. **Check:** CI green on the commit; migrations in the release reviewed (additive? long
   locks?); `.env.production` has every variable the release adds (`.env.example` diff).
2. **Build & push** the images (CI or locally):
   ```bash
   docker build -f docker/Dockerfile -t $REGISTRY/perfume-web:$SHA \
     --build-arg NEXT_PUBLIC_SENTRY_DSN=… --build-arg NEXT_PUBLIC_MEDIA_BASE_URL=… \
     --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=… .
   docker build -f docker/Dockerfile.worker -t $REGISTRY/perfume-worker:$SHA .
   docker push $REGISTRY/perfume-web:$SHA && docker push $REGISTRY/perfume-worker:$SHA
   ```
   `NEXT_PUBLIC_*` values are inlined at build time: staging and production need separate
   web images when they differ (Turnstile site key, Sentry DSN, media URL).
3. **Back up** right before migrating: `scripts/backup/pg-backup.sh` (or a provider snapshot).
4. **Migrate** with the new worker image (migrations are forward-only and must keep the
   previous release working — expand, then contract in a later release):
   ```bash
   export WEB_IMAGE=$REGISTRY/perfume-web:$SHA WORKER_IMAGE=$REGISTRY/perfume-worker:$SHA SITE_DOMAIN=…
   docker compose -f docker/compose.prod.yml pull
   docker compose -f docker/compose.prod.yml run --rm worker node dist/worker/migrate.mjs
   ```
5. **Roll out:** `docker compose -f docker/compose.prod.yml up -d web worker` (a few seconds
   of 502 while `web` restarts on one VM; deploy outside 19:00–23:00 peak hours).
6. **Verify (5 minutes):** `curl -fsS https://$SITE_DOMAIN/api/health`; home, a PDP and
   checkout in vi and en; sign in to `/admin`; Sentry shows no new issue; `docker compose logs
   worker` processes jobs; place a COD test order on staging (not production).
7. Record the SHA and time in the deploy log.

## 3. Rollback

- **App only (no migration in the release):** set `WEB_IMAGE`/`WORKER_IMAGE` to the previous
  SHA and `docker compose -f docker/compose.prod.yml up -d web worker`. Then verify as in §2.6.
- **Release with migrations:** migrations are additive by rule, so the previous images run on
  the new schema: roll back the images only. Never run down-migrations by hand.
- **Bad data migration / corruption:** stop `web` and `worker`, restore with PITR at the
  provider to just before the migration (or `scripts/backup/pg-restore.sh` into a new
  database), point `DATABASE_URL` at it, start the previous images. Payments received in the
  gap: reconcile from the VNPay/payOS merchant portals (§6).
- Purge the Cloudflare cache only if HTML was cached at the edge (normally only static assets).

## 4. Rotate secrets

All secrets live in `.env.production` on the VM (and the CI secret store), never in the
database or admin (ADR-0007). Rotate on staff departure, suspected leak, or yearly.

| Secret | How | Effect |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`, restart web + worker | Signs sessions and order links: everyone is signed out, old `?t=` order links in e-mails stop working (guests use order lookup). TOTP secrets are encrypted with it — **staff must re-enrol 2FA**; plan with the owner. |
| `INTERNAL_API_SECRET` | new value, restart web **and** worker together | Worker → web revalidation calls fail until both restarted |
| `VNPAY_HASH_SECRET` (+ `VNPAY_TMN_CODE`) | request a new secret in the VNPay merchant portal, set it, restart web | IPNs signed with the old secret are rejected (VNPay retries); switch at a quiet hour |
| `PAYOS_CHECKSUM_KEY`, `PAYOS_API_KEY` | regenerate in payOS → channel settings, restart web | Same as VNPay; open QR sessions keep working |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → rotate secret (old key valid 2 h) | None |
| `SMTP_URL` password, S3 keys, `TELEGRAM_BOT_TOKEN` (`/revoke` in BotFather), `SENTRY_AUTH_TOKEN` | provider console, restart | None |
| Database password | provider console → new password, update `DATABASE_URL`, restart web + worker | Short reconnect |
| Backup age key | new key pair; keep the old private key until all old backups expired | None |

After a suspected leak also: revoke all sessions (`delete from sessions;`), review
`audit_logs` for the period, and follow the breach procedure (§7.4).

## 5. Quality gates (before go-live and before big campaigns)

- **Lighthouse CI** (`.github/workflows/lighthouse.yml`, every pull request + manual):
  budgets of §14 on home, listing, PDP, cart, checkout in vi + en, mobile and desktop
  presets, median of 3 runs (`lighthouserc.cjs` documents each budget and the TBT
  relaxation). Reports: the job summary and the `lighthouse-<preset>` artifact. Locally:
  `pnpm build`, start the standalone server, then
  `LH_BASE_URL=http://localhost:3200 CHROME_PATH=$(which google-chrome) pnpm exec lhci autorun`
  and `node scripts/lighthouse-summary.mjs`.
- **First-load JS budget** (`scripts/js-budget.mjs`, CI E2E job after the build): fails when
  the PDP exceeds its ceiling; prints framework vs app KB per storefront route (ADR-0025).
  New client code in the layout, header or footer counts against every page: load dialogs
  and other on-demand widgets with `React.lazy` on first use.
- **OWASP ZAP baseline** (`.github/workflows/zap-baseline.yml`, weekly + manual): scans the
  production build started inside the job (no external target). Rules and the reason for
  each ignored or downgraded rule in `.zap/rules.tsv`; any FAIL blocks go-live. Before
  go-live also run ZAP once against staging (https) for the HTTPS-only rules.
- **k6** (`load/k6/`): 200 browsing users + 20 checkouts/min on staging.
- **CSP:** deploy with `CSP_REPORT_ONLY=true` first, watch Sentry "CSP" events for a few days
  (GTM tags may need a host in `src/lib/security/csp.ts`), then enforce (`false`).
- Manual payment tests (§12): forged signature, wrong amount, replayed IPN, IPN after
  cancellation; one real transaction per method + a refund on production keys.

## 6. Incident checklists

Always: note the start time, open an incident note (what, impact, actions, times), tell the
owner. Customer-facing notice: a site banner (admin → Content → Banners) in vi + en.

### 6.1 Site down / 5xx

1. `curl -I https://$SITE_DOMAIN/api/health/live` — 52x from Cloudflare means the origin is
   unreachable: VM up? `docker compose -f docker/compose.prod.yml ps`.
2. `live` OK but `/api/health` 503 → database: provider status, connections
   (`select count(*) from pg_stat_activity`), disk.
3. `docker compose logs --tail=200 web`; Sentry for the first error after the last deploy →
   rollback (§3) when a deploy is the cause.
4. Disk full: `docker system prune` (old images), log rotation.

### 6.2 Payment gateway outage (VNPay or payOS)

Signs: `payment.ipn.failed` / `gatewayError` in logs, staff alerts, customers stuck on
"Complete your payment".

1. Confirm on the gateway's status channel / merchant support hotline.
2. Post a banner: the method is temporarily unavailable, COD and the other method still work.
   Buyers can switch method on the result page (retry with another method).
3. Orders keep their 30-minute reservation and expire as usual (ADR-0006); nothing to cancel
   by hand. Do **not** mark orders paid from screenshots: payment status changes only from a
   verified IPN/webhook or the reconciliation screens (ADR-0005).
4. When the gateway is back: check its merchant portal for transactions paid during the
   outage whose IPN never arrived; the late IPN is processed automatically (an IPN after
   cancellation lands in the refund queue, §3.5). Unmatched ones go through
   admin → Payments → Events.
5. If IPNs are refused with `payment.ipn.ip_rejected`, the gateway changed its source IPs:
   update `VNPAY_IPN_ALLOWED_IPS` / `PAYOS_WEBHOOK_ALLOWED_IPS` (or unset to disable) and
   restart web. Signatures are still verified.
6. Known gap: there is no switch to hide one method at checkout yet; follow-up is a
   `settings` flag read by the checkout quote.

### 6.3 E-invoice provider outage (MISA / Viettel, D13)

1. Issuing runs in the worker with retries and backoff; failed jobs end in the dead-letter
   queue (`system.dead-letter`, kept 30 days) and alert staff.
2. Orders still ship; nothing in checkout depends on the provider.
3. Tell the accountant the outage window: invoices must be issued at delivery time; for a
   long outage the provider's web portal (manual issue) or the accountant's instruction applies.
4. After recovery: re-run the failed jobs (move them from the dead-letter queue back to the
   e-invoice queue, or use the admin "retry e-invoice" action if available) and check that
   every `delivered` order of the window has `orders.einvoice_ref`.

### 6.4 Abuse: brute force, carding, scraping

- Rate limits are shared in `rate_limits` (`server/lib/rate-limit.ts`); `rate_limit.blocked`
  and `turnstile.rejected` log lines show the scope.
- Raise Cloudflare protection: Security level "High" / "I'm under attack", a WAF rate-limit
  rule on `/dang-nhap`, `/en/sign-in`, `/api/auth/*`, checkout; Turnstile must be on
  (`TURNSTILE_SECRET_KEY` + site key).
- Never challenge `/api/webhooks/*` (gateways cannot solve challenges): add a WAF skip rule.
- Turnstile itself down (forms answer "security check failed" for everyone): unset
  `TURNSTILE_SECRET_KEY`, restart web; set it again when Cloudflare recovers.

### 6.5 Suspected data breach (Decree 356/2025)

1. Contain: rotate the affected secrets (§4), revoke sessions, block the source in Cloudflare.
2. Preserve evidence: logs, `audit_logs`, Sentry events; take a database snapshot.
3. Owner + lawyer assess within 24 h and notify the authority and affected customers within
   the legal deadline (the lawyer confirms it under Decree 356/2025; plan for 72 h); keep a
   written record of the incident and the notifications.

### 6.6 Worker stuck / jobs piling up

- `select name, state, count(*) from pgboss.job group by 1, 2 order by 3 desc;`
- Restart: `docker compose -f docker/compose.prod.yml restart worker` (graceful 30 s stop).
- Failing job: Sentry shows the error; fix, deploy, then retry from the dead-letter queue.

## 7. Routine

| When | Task |
| --- | --- |
| Daily | Sentry new issues; staff alerts handled; backup job succeeded (cron e-mail / exit code) |
| Weekly | Dependabot PRs; `pnpm audit`; disk usage; failed jobs |
| Monthly | Search Console coverage + Core Web Vitals; rate-limit / Turnstile logs; review admin staff list |
| Quarterly | Restore drill ([backup-restore.md](./backup-restore.md)); Cloudflare IP ranges in `docker/Caddyfile`; rotate yearly secrets when due |
| Before campaigns | k6 run; scale per §14.2 |
