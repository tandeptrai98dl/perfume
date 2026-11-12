# ADR-0027: Staff-opened returns, return-window override and COD returns before remittance

- Status: Accepted (2026-11-12, recommended option taken under the project owner's standing instruction)
- Date: 2026-11-12
- Decision ID: D27 (refines D05 order state machine and D17 returns policy)

## Context

ADR-0017 implemented customer return requests (M3 wave 2) with three gaps left for go-live
(DEVELOPMENT_PLAN "Remaining before go-live"):

1. Customers call or message the shop; staff could not open a return for them. A customer
   whose request was rejected could never ask again, even within the window.
2. Exceptions to the 7-day window (a defect reported in time by phone, a customer abroad) had
   no audited path. After the window `orders.complete-delivered` moves the order to the
   terminal `completed` state within an hour, so an override limited to `delivered` orders
   would be useless.
3. COD orders returned before the carrier remits were only alerted ("shortfall"): the
   remittance refused `returned` orders, and reimbursed return shipping beyond the order's
   money had no refund record at all.

## Decision

- **Staff-opened returns:** staff with `orders.process` open a return from the admin order
  page with the customer's rules (lines, reason, resolution, seal, description). The
  `return_requested` event records `openedBy = staff`; audit `order.return_open`.
- **One open request at a time:** a rejected request may be followed by a new one while the
  window is open (customer or staff); a received return ends the order's returns.
- **Window override:** only Owner/Manager (`payments.refund`) may open a return after the
  window, with a reason (≥ 5 characters) stored on the request and audited. The order state
  machine gains `completed → return_requested` (actor `manager`) and
  `return_requested → completed` (staff): a return reopened on a completed order closes back to
  `completed` (rejection, partial return, replacement) keeping the original `completed_at`;
  a full return still ends in `returned`. `completed` is no longer terminal, so "closed"
  statuses (privacy deletion) are listed explicitly: `completed`, `cancelled`, `returned`.
- **COD returns before remittance:** the refund owed by a received return is split
  (`splitReturnRefund`): queued from money held; *deferred* (event `refund_deferred`) for money
  still to come, queued automatically as a bank-transfer refund when the remittance or any
  later payment is recorded; a *payout* (`refunds.reason = return_shipping_payout`, bank
  transfer, no payment attempt) for reimbursed return shipping beyond the order's money; any
  rest is a shortfall alert. `returned` orders that were delivered (`delivered_at` set) can be
  ticked in a COD remittance; a returned order's late money is no longer refunded in full when
  it went through a customer return. Payouts do not reserve or change the order's money
  (`amount_refunded`, `payment_status`): they are a cost of the shop, completed manually.

## Consequences

- No schema change: requests, deferred refunds and photo references stay in `order_events`;
  payouts are flagged by their reserved reason (staff cannot create one by hand).
- Reports that treat `completed` as final may see an order leave and come back to `completed`
  around an overridden return (`order.status-changed` events are emitted as usual).
- Review invitations and e-invoice issuing are unaffected (they follow `shipped → delivered`).
- If payouts or deferred refunds need reporting of their own, a `refunds.kind` column can
  replace the reserved reason later.
