# k6 load test

`storefront.js` checks the §14 capacity estimate before go-live (§15 M3 item 3): **200
concurrent browsing users + 20 checkouts per minute** on one web VM.

| Scenario   | Executor                                               | What it does                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browse`   | `ramping-vus` to 200 VUs (1 min ramp, then `DURATION`) | Weighted mix of home, listing (incl. a sorted listing), PDP and brands in vi/en, 30% also call search suggestions; 1–5 s think time                                                               |
| `checkout` | `constant-arrival-rate` 20/min (after the ramp)        | Real browser (k6 browser, Chromium): PDP → add to cart → checkout as a guest → VNPay → **sandbox simulator** (signed IPN through the real processing path) → result page shows "Payment received" |

Thresholds (the run fails when one is missed): HTTP errors < 1%, page p95 < 500 ms under
load, suggestions p95 < 300 ms, checks > 99%, ≥ 95% of the scheduled checkouts paid, browser
LCP p75 < 2.5 s and CLS p75 < 0.1. `checkout_place_to_paid_ms` reports place-order → paid.

## Target environment

Run against **staging** (or a dedicated load VM), never production. The target needs:

- `PAYMENT_SIMULATOR=true` — only accepted with a localhost `APP_URL`, so run the target with
  `APP_URL=http://localhost:3200` and k6 on the same host/network (`BASE_URL` may differ), or
  keep VNPay sandbox keys unset on a non-production build (`NODE_ENV` ≠ production enables
  the simulator for gateways without keys).
- `TRUSTED_IP_HEADER=x-forwarded-for` and direct access (not through Cloudflare): every VU
  sends its own `x-forwarded-for`, otherwise all checkouts share one IP and hit the
  place-order limit (5/min/IP). Never use this setting on a public server.
- Turnstile off (`TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset).
- `AUTH_RATE_LIMIT` unchanged (the test does not sign in).
- Enough stock on `PRODUCT_SLUG`'s default variant: each checkout buys one unit (10 min ×
  20/min = 200 units). Restore stock / delete the `k6+…@example.com` orders afterwards.
- The demo seed (`pnpm db:seed`) or real catalogue data with the product slug below.
- Workers running (`pnpm worker:start`) so outbox jobs (e-mails to Mailpit, alerts) are
  drained like in production.

## Run

```bash
# k6 ≥ 1.3 (browser module with getByRole); https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run \
  -e BASE_URL=http://localhost:3200 \
  -e DURATION=10m \
  -e PRODUCT_SLUG=maison-lumiere-cedre-nocturne-edt \
  load/k6/storefront.js

# Smoke run (2 minutes, 20 users, 6 checkouts/min) before the full test:
k6 run -e DURATION=2m -e BROWSE_VUS=20 -e CHECKOUTS_PER_MINUTE=6 load/k6/storefront.js
```

Environment variables: `BASE_URL` (default `http://localhost:3200`), `DURATION` (`10m`),
`BROWSE_VUS` (`200`), `CHECKOUTS_PER_MINUTE` (`20`), `PRODUCT_SLUG`. `K6_BROWSER_HEADLESS`
defaults to true.

## Reading the results

- Watch the VM during the run: web CPU (§14.2 scales out above 70% sustained), Postgres
  connections (pool max 10 per web process) and `pg_stat_statements` top queries.
- A high `http_req_failed` with status 429 means the target still rate-limits one shared IP:
  check `TRUSTED_IP_HEADER`.
- Record the numbers (p95 per kind, CPU, DB load, checkout duration) in the go-live notes;
  rerun before a flash sale (§14.2).
