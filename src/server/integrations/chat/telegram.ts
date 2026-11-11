/**
 * Telegram Bot API adapter for internal staff alerts (ADR-0019). `sendMessage` only; the
 * caller formats messages without personal data (order code, amount, province at most).
 * Returns `null` from the factory when the bot is not configured, so callers skip the channel.
 */

export type ChatNotifier = {
  send(text: string): Promise<void>;
};

export type TelegramConfig = {
  botToken?: string | null;
  chatId?: string | null;
  fetch?: typeof fetch;
  /** Bot API origin; overridable for tests. */
  apiBaseUrl?: string;
};

/** Telegram rejects messages above 4096 characters. */
const MAX_LENGTH = 4096;

export function createTelegramNotifier(config: TelegramConfig): ChatNotifier | null {
  const { botToken, chatId } = config;
  if (!botToken || !chatId) return null;
  const doFetch = config.fetch ?? fetch;
  const base = (config.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');

  return {
    async send(text) {
      const response = await doFetch(`${base}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, MAX_LENGTH),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // Never include the URL in errors: it contains the bot token (ADR-0007).
      if (!response.ok) throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
    },
  };
}
