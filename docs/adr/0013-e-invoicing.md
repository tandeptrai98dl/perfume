# ADR-0013: Automatic e-invoice for every order

- Status: Accepted — pending accountant confirmation of timing and template
- Date: 2026-11-11
- Decision ID: D13

## Context

Vietnamese retail sales may require an e-invoice for every transaction, not only when the buyer requests one. Manual invoicing does not scale and is error-prone.

## Decision

Issue an e-invoice automatically for every order when it transitions to `delivered`, via one provider's API (MISA meInvoice or Viettel S-Invoice) behind the `integrations/einvoice` adapter. If the buyer entered company details at checkout (`orders.vat_invoice`), the invoice uses their tax code. The job is asynchronous with retries; results are stored in `orders.einvoice_ref` and `einvoice_issued_at`; failures alert staff.

## Consequences

- Invoice issuing never blocks order transitions.
- Provider can be swapped without changing domain code.
- The accountant confirms issue timing, template and series before go-live.
- *Implementation note (M3):* the VAT rate is the `einvoice.vatRatePercent` setting (default 10 %; shop prices are VAT-inclusive and each line is split into taxable amount + VAT, rounded per line). The rate, the per-line rounding and the treatment of shipping and gift-wrap fees as service lines at the same rate are **pending accountant confirmation**, like the template and series (`EINVOICE_TEMPLATE_CODE`, `EINVOICE_SERIES`).

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
