# ADR-0025: Customer notes in their own table, erasable on deletion requests

- Status: Accepted
- Date: 2026-11-12

## Context

Staff write internal notes on customers and a reason when they set or clear the COD risk flag
(§11.2 "Customers", D16). The first implementation (M3 wave 2) stored that text in the
append-only `audit_logs` diff. Notes describe a person ("refused two deliveries, rude on the
phone"). Under the Personal Data Protection Law 91/2025 and Decree 356/2025, a deletion request
must remove such personal data. `audit_logs` is append-only and is never rewritten, so the
note text would survive anonymisation.

## Decision

- Add a `customer_notes` table: `id`, `user_id` FK (cascade), `kind` (`note` | `cod_risk`),
  `body`, `author_id`, `created_at`. It is owned by the customer module.
- The note text and the risk reason live only in `customer_notes`. The audit row keeps the
  fact and who did it (`noteId`, flag from → to), without the text.
- Privacy anonymisation deletes the subject's `customer_notes` (an erasure step in the customer
  module), so the audit trail stays complete but holds no note text.

## Consequences

- One small migration (`0006`); no change to the audit log's append-only rule.
- The customer history shows "note removed" for audit entries whose note was erased.
- Guests (no account) still cannot have notes; their phone history keeps warning on COD orders.
