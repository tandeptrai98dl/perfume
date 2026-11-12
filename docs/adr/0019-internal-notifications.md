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
- All sends logged in `notification_logs`. M2 note: that table is not created yet; order-related sends are recorded in `order_events` (`email_sent`, `staff_alert_sent`) and channels are configured by env (`STAFF_ALERT_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) until the M3 settings screen.
- No personal data beyond order code and amount in Telegram messages.
- M3 wave 2 note: `/admin/settings` stores the alert recipients (`alerts.emailRecipients`, up to 5) and the Telegram chat id (`alerts.telegramChatId`); `resolveAlertChannels()` in the settings module gives settings precedence over `STAFF_ALERT_EMAIL` / `TELEGRAM_CHAT_ID` (the notification module resolves the channels with it for every alert). The bot token stays in env (ADR-0007).

See also: [ARCHITECTURE.md](../ARCHITECTURE.md), section 0.
