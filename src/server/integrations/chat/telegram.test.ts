import { describe, expect, it } from 'vitest';

import { createTelegramNotifier } from './telegram';

describe('createTelegramNotifier', () => {
  it('is skipped when the bot is not configured', () => {
    expect(createTelegramNotifier({})).toBeNull();
    expect(createTelegramNotifier({ botToken: 'x' })).toBeNull();
    expect(createTelegramNotifier({ chatId: '1' })).toBeNull();
  });

  it('posts sendMessage to the Bot API with the chat id', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const notifier = createTelegramNotifier({
      botToken: '123:abc',
      chatId: '-100200',
      fetch: async (input, init) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response('{"ok":true}', { status: 200 });
      },
    })!;
    await notifier.send('Đơn mới PF-261111-7K3Q');
    expect(calls).toEqual([
      {
        url: 'https://api.telegram.org/bot123:abc/sendMessage',
        body: {
          chat_id: '-100200',
          text: 'Đơn mới PF-261111-7K3Q',
          disable_web_page_preview: true,
        },
      },
    ]);
  });

  it('throws without leaking the token so the job retries', async () => {
    const notifier = createTelegramNotifier({
      botToken: 'secret-token',
      chatId: '1',
      fetch: async () => new Response('bad', { status: 502 }),
    })!;
    await expect(notifier.send('x')).rejects.toThrow(/HTTP 502/);
    await expect(notifier.send('x')).rejects.not.toThrow(/secret-token/);
  });
});
