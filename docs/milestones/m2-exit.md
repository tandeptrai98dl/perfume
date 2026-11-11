# M2 exit checklist — cart, checkout, payments, orders

Status of every M2 exit criterion and scope item (ARCHITECTURE.md §15 "M2", §3.4, §10.3–10.6,
§16.2), checked against `main` @ 5741c47 plus the `feat/m2-purchase-e2e` fixes. Legend:
**Done** = implemented and covered by the tests named; **Partial** = works, a part is open;
**Open** = not done yet (owner named).

Verified on 2026-11-12 with: `pnpm test`, integration suites `checkout`, `payment`, `order`,
`jobs`, `cart` (79 tests, real PostgreSQL), and Playwright `purchase-*`, `admin-purchase` on a
production build (desktop 1280 + 768, mobile 375, vi and en).

## Exit criteria (§15 M2)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| E1 | E2E for all three payment methods green in vi and en | **Done** | `tests/e2e/purchase-cod.spec.ts`, `purchase-vietqr.spec.ts`, `purchase-vnpay.spec.ts`: real UI from the product page (add to cart → mini-cart → cart → guest checkout with province/ward, delivery option, WELCOME10 → place order → result page → order view), vi + en × desktop + mobile (16 tests). COD lands in `awaiting_confirmation`; COD > 5,000,000 ₫ pays a 20% deposit by VietQR and is confirmed with the balance due; VietQR is completed by the signed payOS webhook (simulator key) and turns "Paid" by polling; VNPay redirects straight to the gateway simulator, which sends the IPN and returns to the result page. `admin-purchase.spec.ts`: staff find and confirm a storefront COD order (vi + en orders). |
| E2 | Two buyers for the last unit → one order | **Done** | `tests/integration/checkout/place-order.test.ts` "lets exactly one of two buyers racing for the last unit place an order"; `tests/integration/order/foundation.test.ts` "lets exactly one of two concurrent buyers reserve the last unit". |
| E3 | Replayed IPN creates no duplicate | **Done** | `tests/integration/payment/payments.test.ts` "full payment → … a replay changes nothing", "two identical IPNs arriving at the same time are processed exactly once"; E2E `purchase-vietqr.spec.ts` replays the webhook and asserts one succeeded payment and one `payment.received` job; `purchase-vnpay.spec.ts` reloads the signed return URL and asserts no new event or job. |
| E4 | IPN after cancellation lands in the refund queue | **Done** | `payments.test.ts` "IPN after cancellation records the money, queues a refund and alerts staff", "auto-cancelling a COD order whose deposit was paid queues a refund"; `tests/e2e/admin-payments.spec.ts` "refund queue: complete the refund of a payment received after cancellation". |
| E5 | Staff complete a manual order end to end on staging | **Open** | Manual order creation is the wave-2 "manual orders" stream (the admin button is disabled on `main`); a staging environment does not exist yet (M3 §15 item 4). Re-check once both land. |

## Scope items (§15 M2)

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| S1 | Cart (guest + member, merge), mini-cart, gift options, coupons | **Done** | `tests/integration/cart/cart.test.ts` (caps, ownership, coupons, gift options, merge incl. race); `tests/e2e/cart.spec.ts` (PDP → mini-cart → quantity → coupon → totals, language switch keeps the cart, out of stock); purchase specs. |
| S2 | Bilingual one-page checkout, 2-level addresses, zone rates, VAT details, consents | **Done** | `tests/e2e/checkout.spec.ts` (COD, online, deposit notice, validation, empty cart); `place-order.test.ts` (VAT invoice, consents, ward outside province, stale rate, stale total); purchase specs pick province → ward and standard / express delivery. |
| S3 | `placeOrder` + time-limited reservations; state machines (§3.5); expiry and 24 h COD jobs | **Done** | `place-order.test.ts` (30 min / 24 h reservations, idempotent checkout key, rollback); `state-machine.test.ts`; `payments.test.ts` "expire-unpaid cancels orders whose reservations expired…", "cancel-unconfirmed-cod and complete-delivered respect their windows" (stock released through `transitionOrder`). Crons in `CRON_JOBS` (every minute / 5 min / hourly). |
| S4 | Payments: COD (threshold + deposit), payOS VietQR, VNPay — sandboxes, IPN/webhooks, idempotency, retry | **Done** | `payments.test.ts` (sessions, reuse, retry with method change, reservation extension cap, wrong amount / bad signature, failed IPN), `payments.test.ts` in `integrations/payments` (signatures), `tests/e2e/checkout-result.spec.ts` (QR panel, forged return URL, expired session retry), purchase specs. |
| S5 | Admin orders: list, detail, transitions, manual orders, edits, tracking, printing, cancel/refund, COD reconciliation; admin coupons, shipping, payments | **Partial** | Done: `tests/integration/order/admin.test.ts`, `tests/e2e/admin-orders.spec.ts` (queues, confirm → pack → ship < 2 min, slips, bulk confirm, deposit guard, manager-only cancel), `admin-payments.spec.ts`, `admin-coupons.spec.ts`, `admin-purchase.spec.ts`. Open: manual orders and order edits (wave-2 streams). |
| S6 | vi/en emails by `orders.locale`; Telegram + email staff alerts; guest lookup; account pages | **Done** | `tests/integration/jobs/notifications.test.ts` (confirmation, status, payment e-mails once each, English orders, alerts without PII, retries); `tests/e2e/account.spec.ts` (sign-up, profile, addresses, orders, cancel, guest lookup, password reset); purchase specs assert `order.placed`, `payment.received`, `order.status-changed` are enqueued in the business transaction and look the order up by code + phone. |

## Required tests (§16.2) relevant to M2

| Type | Scope | Status |
| --- | --- | --- |
| Unit | Cart/order pricing, coupons, shipping fees, order and payment transition tables, VNPay/payOS signatures, permission map | **Done** (`pricing.test.ts`, `rules.test.ts`, `state-machine.test.ts`, `status.test.ts`, `payments.test.ts`, `permissions.test.ts`) |
| Integration | Concurrent `placeOrder`, reservation expiry, replayed IPN, IPN after cancellation | **Done** (see E2–E4, S3) |
| Integration | Order edit with optimistic locking | **Open** — wave-2 "order edits" stream (`transitionOrder` already refuses stale versions: `foundation.test.ts`) |
| Integration | E-invoice job retry | Not M2 (automatic e-invoicing is M3 item 2, D13) |
| E2E | PDP → cart → checkout (COD, VietQR mock, VNPay sandbox) in vi and en | **Done** (E1) |
| E2E | Language switch keeps the cart; sign-up/sign-in | **Done** (`cart.spec.ts`, `account.spec.ts`) |
| E2E | Admin order processing | **Done** (`admin-orders.spec.ts`, `admin-purchase.spec.ts`) |
| E2E | Admin manual order | **Open** — wave-2 "manual orders" stream |

## Definition of Done checks on the purchase flow

| Check | Status | Evidence |
| --- | --- | --- |
| No console errors | **Done** | Every purchase spec collects `console.error` / page errors across PDP → result page → order view (and the admin pages). |
| axe clean on checkout, result and order pages | **Done** | `checkPage()` in `tests/e2e/helpers/purchase.ts` (WCAG 2.2 AA tags) on the filled checkout, the result page before and after payment, the guest lookup view. |
| 375 / 768 / 1280 px | **Done** | Mobile project (375), desktop project (1280) and a 768 px pass in `checkPage()`: no horizontal overflow. |
| Keyboard accessible | **Partial** | Controls are native/Radix (labelled radios, checkboxes, comboboxes opened and filtered by typing); the form focuses the first invalid field. No keyboard-only purchase run yet. |

## Fixes made while verifying (branch `feat/m2-purchase-e2e`)

1. `fix(checkout)`: VNPay orders now go straight to the gateway after "Place order and pay"
   (§10.4); before, the buyer landed on the result page and had to press "Pay with VNPay".
2. `fix(payment)`: the result page is rendered twice for the place-order redirect; both renders
   opened a payment session concurrently, so every online order got two payOS sessions (the
   first cancelled while its QR was being shown). Renders now share the in-flight creation.
3. `fix(checkout)`: the one-column checkout overflowed 375 px by 14–17 px when a product name
   was long (implicit `auto` grid column); now `grid-cols-1`.

## Known gaps / follow-ups

- E5 and the manual-order / order-edit items depend on the wave-2 streams and staging.
- The first-session de-duplication (fix 2) is per process; two web instances rendering the same
  order's first visit at the same moment could still open two sessions (harmless: an older
  session paid later still counts, §3.5). A durable guard belongs in `createPaymentSession`
  (payment module): treat a just-created pending session that has no checkout URL / QR yet as
  in flight instead of cancelling it.
- Workers do not run during E2E: e-mails and alerts are asserted as enqueued outbox jobs; their
  delivery is covered by `tests/integration/jobs/notifications.test.ts`.
- Customer return requests (D17 form + photos) are not built yet; the state machine allows
  `delivered → return_requested`.
