# ADR-0008: Verified reviews for members and guests

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D08

## Context

Reviews are a key trust signal for high-value perfumes, but most buyers check out as guests.

## Decision

Members review purchased items from their account. After an order is delivered, guests receive an email with a one-time review link (token stored hashed, valid 30 days). Each purchased order item allows one review (`reviews.order_item_id` unique), labelled 'Verified purchase'. All reviews are moderated before publication.

## Consequences

- Tables `reviews` and `review_invitations`.
- Route `review/[token]` (`/danh-gia/[token]`, `/en/review/[token]`), noindex.
- `AggregateRating` JSON-LD only when approved reviews exist.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
