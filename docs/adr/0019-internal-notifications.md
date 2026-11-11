# ADR-0019: Internal staff notifications via Telegram

- Status: Accepted
- Date: 2026-11-11
- Decision ID: D19

## Context

Staff need immediate alerts for new orders, high-value COD, suspicious IPNs, low stock and e-invoice failures.

## Decision

Send internal alerts through a Telegram bot (official, free Bot API) plus email. Zalo is reserved for customer messaging (ZNS/OA in Phase 2).

## Consequences

- Adapter `integrations/chat/telegram.ts`; channels configured in settings.
- All sends logged in `notification_logs`.
- No personal data beyond order code and amount in Telegram messages.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
