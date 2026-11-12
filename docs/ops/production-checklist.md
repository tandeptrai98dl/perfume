# Production environment checklist

Tick every item for staging first, then production (ARCHITECTURE.md §15 M3 item 4 and the
go-live gate). Owner signs off in the go-live notes.

## Infrastructure

- [ ] VM (4 vCPU / 8 GB) on the Vietnam cloud (D12); SSH keys only, root login disabled,
      automatic security updates; firewall: 80/443 only from Cloudflare ranges, 22 from admin IPs.
- [ ] Managed PostgreSQL 17, private network, TLS, daily snapshots + PITR 14 days; pool sized
      for web (10) + worker (10) + pg-boss.
- [ ] S3-compatible media bucket (public read via CDN) and a separate backup bucket
      (private, versioning/object lock); backup cron installed and one backup verified
      ([backup-restore.md](./backup-restore.md)).
- [ ] `docker/compose.prod.yml` + `docker/Caddyfile` deployed; `SITE_DOMAIN` set; Caddy got
      its certificate (Cloudflare SSL mode **Full (strict)**).
- [ ] Health checks: `/api/health` (ready) and `/api/health/live` monitored by an external
      uptime check (1 min) alerting the owner.

## Cloudflare

- [ ] DNS proxied (orange cloud) for the apex and `www` (redirect `www` → apex, ADR-0020).
- [ ] SSL/TLS Full (strict), Always Use HTTPS, minimum TLS 1.2, HSTS is sent by the app.
- [ ] WAF managed rules on; bot fight mode on; **skip rule** for `/api/webhooks/*` (no
      challenges, no bot fight mode) — gateways cannot solve challenges.
- [ ] Rate-limit rule (defence in depth) on `/api/auth/*` and the sign-in pages.
- [ ] Turnstile widget created for the production hostname (managed mode); keys stored:
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web image build arg) + `TURNSTILE_SECRET_KEY` (env).
- [ ] Cache rules: cache `/_next/static/*` and media; HTML not cached at the edge.

## Application env (`.env.production`, see `.env.example`)

- [ ] `NODE_ENV=production`, `APP_URL=https://<domain>` (no trailing slash).
- [ ] Fresh `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET` (`openssl rand -base64 32`), unique
      per environment.
- [ ] `TRUSTED_IP_HEADER=x-client-ip` (set by Caddy; required in production).
- [ ] `CSP_REPORT_ONLY=true` for the first days, then `false`; CSP reports reach Sentry
      (`NEXT_PUBLIC_SENTRY_DSN`) or `CSP_REPORT_URI`.
- [ ] `PAYMENT_SIMULATOR` unset; `AUTH_RATE_LIMIT` unset (on).
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`; source maps
      upload token only in CI.
- [ ] `SMTP_URL`, `EMAIL_FROM` with the verified sending domain; `STAFF_ALERT_EMAIL`,
      `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (test alert received).
- [ ] Media: `S3_*`, `MEDIA_STORAGE=s3`, `NEXT_PUBLIC_MEDIA_BASE_URL` (CDN URL, build arg).
- [ ] First owner account created (`pnpm auth:create-staff` in the worker image) with TOTP.
- [ ] Database seeded without demo data (`node dist/worker/seed.mjs`, no `SEED_DEMO`;
      `legal.conflicts` empty) and `/admin/settings` filled in ([seed.md](./seed.md)).

## Payments (ADR-0007: keys only in env)

- [ ] **VNPay production:** merchant contract signed; `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`
      from the production merchant portal; `VNPAY_PAYMENT_URL=https://pay.vnpay.vn/vpcpay.html`
      and the production `VNPAY_API_URL` from VNPay's onboarding e-mail; IPN URL
      `https://<domain>/api/webhooks/vnpay` and return URL registered with VNPay.
- [ ] `VNPAY_IPN_ALLOWED_IPS` set to the IPN source IPs VNPay publishes for production (from
      the merchant documentation; verify, they change rarely), or left unset with a note.
- [ ] **payOS production:** channel created on the business account; `PAYOS_CLIENT_ID`,
      `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`; webhook URL `https://<domain>/api/webhooks/payos`
      confirmed in the payOS dashboard (it sends a test call).
- [ ] `PAYOS_WEBHOOK_ALLOWED_IPS` only if payOS publishes source IPs (otherwise unset —
      signatures protect the endpoint).
- [ ] Real transactions with COD, VietQR and VNPay plus one refund succeed (go-live gate);
      forged-signature / wrong-amount / replay tests done on staging.
- [ ] Sandbox keys removed from production env; staging keeps sandbox keys.

## E-mail domain (deliverability)

- [ ] **SPF:** one TXT record on the sending domain, e.g. `v=spf1 include:<provider> -all`
      (only the e-mail provider; no second SPF record).
- [ ] **DKIM:** the provider's CNAME/TXT selectors published and verified in its console.
- [ ] **DMARC:** `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; adkim=s; aspf=s`
      at launch, raise to `p=quarantine` after 2–4 weeks of clean reports, then `p=reject`.
- [ ] Return-path / bounce domain aligned; `EMAIL_FROM` uses the verified domain.
- [ ] Test: order confirmation in vi and en reaches Gmail and Outlook inbox (not spam);
      mail-tester score ≥ 9/10.

## Search and measurement

- [ ] Google Search Console: Domain property (DNS TXT), sitemap `https://<domain>/sitemap.xml`
      submitted; both locales visible; no `noindex` on public pages.
- [ ] Bing Webmaster Tools (import from Search Console).
- [ ] GA4 + Meta Pixel via GTM loaded only after consent; GTM has no Custom HTML tags loading
      other hosts (CSP, ADR-0024); test purchase event recorded with the `locale` dimension.
- [ ] GTM/GA4: query parameters `t`, `token`, `s`, `e` redacted from `page_location` and
      `page_referrer`, and `/danh-gia/*`, `/en/review/*` excluded (signed-link tokens,
      docs/security/review-2026-11.md F-07).
- [ ] `robots.txt` allows the storefront and blocks `/admin`, `/api`, cart, checkout, account.

## Security sign-off

- [ ] ZAP baseline on staging: no FAIL (`.github/workflows/zap-baseline.yml`).
- [ ] CSP enforced without violations on key pages (E2E `security-headers.spec.ts`, Sentry).
- [ ] Every admin Server Action reviewed for `requirePermission` (§12).
- [ ] Open items of docs/security/review-2026-11.md closed or accepted by the owner.
- [ ] Lighthouse budgets met (`.github/workflows/lighthouse.yml`); k6 run recorded.
- [ ] Restore drill passed; runbook read by the on-call people.
