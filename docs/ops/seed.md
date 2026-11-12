# Seeding: production base data vs demo data

`pnpm db:seed` (development) and `node dist/worker/seed.mjs` (worker image, staging and
production) run the same seed (`src/server/db/seed/index.ts`). Every step is idempotent:
running it again after a deploy is safe and never overwrites what staff changed in admin.

## What is seeded

| Step | Base (always) | Demo only | Re-run behaviour |
| --- | --- | --- | --- |
| Provinces and wards (2-level admin units) | ✓ | | insert missing rows |
| Settings with a default (COD threshold/deposit, COD confirmation window, payment session, online reservation, max quantity per line, gift-wrap fee, returns window, VAT rate) | ✓ | | insert missing keys; values saved in admin → Settings are kept |
| Default stock location | ✓ | | created once |
| Policy pages (returns, shipping, payment, privacy, terms, cookies; vi + en drafts "pending lawyer review", `legal-drafts.ts`) | ✓ | | created by page key; an existing page is never touched; a deleted policy page is re-created (the law requires it); a page whose slug another page already uses is skipped and reported under `legal.conflicts` |
| Footer "legal" menu (vi + en, links to the published policy pages) | ✓ | | created once per locale; an edited menu is kept |
| Shipping zones and rates | ✓ | | only when no zone exists |
| Fictional catalogue (brands, products, stock) | | ✓ | only when no product exists |
| Demo pages (about, authenticity, contact, FAQ), journal posts, header/footer menus, banners, demo redirect | | ✓ | only when none of the demo pages exists |
| Placeholder seller information (`company.*`, marked "dữ liệu mẫu") | | ✓ | insert missing keys |
| Demo coupons | | ✓ | insert missing codes |

Not seeded in production: seller information, MOIT notification URL/badge, alert recipients,
Telegram chat id, SEO defaults and the e-mail sender. The owner fills them in at
`/admin/settings` before go-live (the footer hides empty lines; `EMAIL_FROM`,
`STAFF_ALERT_EMAIL` and `TELEGRAM_CHAT_ID` from env are the fallback). Secrets are never
seeded or stored in `settings` (ADR-0007).

## Demo or not

| Command | Demo data |
| --- | --- |
| `pnpm db:seed` | yes, unless `SEED_DEMO=false` or `NODE_ENV=production` |
| `node dist/worker/seed.mjs` (worker image) | no, unless `SEED_DEMO=true` |

Production and staging databases are seeded with the worker image **without** `SEED_DEMO`:

```bash
docker compose -f docker/compose.prod.yml run --rm worker node dist/worker/migrate.mjs
docker compose -f docker/compose.prod.yml run --rm worker node dist/worker/seed.mjs
```

The output is one JSON line, e.g.
`{"legal":{"created":["returns",…],"skipped":[],"conflicts":[]},"demo":{"skipped":true,…}}`.
Check that `legal.conflicts` is empty; otherwise rename the conflicting page in admin →
Content → Pages and run the seed again.

## After seeding a production database

1. Create the first owner (`pnpm auth:create-staff`, see the README) and enrol TOTP.
2. `/admin/settings`: seller information (name, tax code, address, legal representative,
   hotline, e-mail, business licence), checkout & COD values (D16), returns window (D17),
   VAT rate once the accountant confirms it (D13), alert recipients and Telegram chat id
   (D19), SEO defaults, sender name/address.
3. After the Ministry of Industry and Trade notification: paste the record URL and the badge
   image URL from online.gov.vn in the same screen; the footer shows the badge.
4. Content → Pages: replace the policy drafts with the lawyer-approved wording, remove the
   "draft" notice, publish the English cookie policy when reviewed.
