import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/server/db/client';

import { createSenderResolver, formatSender, resolveAlertChannels } from './service';

/** Minimal `select().from().where()` stub returning settings rows. */
function fakeDb(rows: () => Promise<{ key: string; value: string }[]>) {
  const where = vi.fn(rows);
  const db = { select: () => ({ from: () => ({ where }) }) } as unknown as Pick<Database, 'select'>;
  return { db, where };
}

describe('formatSender', () => {
  it('keeps EMAIL_FROM when nothing is stored', () => {
    expect(formatSender({ name: null, address: null }, 'Perfume Store <no-reply@shop.vn>')).toBe(
      '"Perfume Store" <no-reply@shop.vn>',
    );
    expect(formatSender({ name: null, address: null }, 'no-reply@shop.vn')).toBe(
      'no-reply@shop.vn',
    );
  });

  it('replaces the name and/or the address', () => {
    const env = 'Perfume Store <no-reply@shop.vn>';
    expect(formatSender({ name: 'Hương Thơm', address: null }, env)).toBe(
      '"Hương Thơm" <no-reply@shop.vn>',
    );
    expect(formatSender({ name: null, address: 'cskh@shop.vn' }, env)).toBe(
      '"Perfume Store" <cskh@shop.vn>',
    );
    expect(formatSender({ name: 'A "B"', address: 'cskh@shop.vn' }, 'x@y.vn')).toBe(
      '"A B" <cskh@shop.vn>',
    );
  });
});

describe('resolveAlertChannels', () => {
  const env = { staffAlertEmail: 'env@shop.vn', telegramBotToken: 'token', telegramChatId: '-1' };

  it('prefers settings over env', () => {
    expect(
      resolveAlertChannels({ emailRecipients: ['a@shop.vn'], telegramChatId: '-200' }, env),
    ).toEqual({ emailRecipients: ['a@shop.vn'], telegram: { botToken: 'token', chatId: '-200' } });
  });

  it('falls back to env and needs the bot token for Telegram', () => {
    expect(resolveAlertChannels({ emailRecipients: [], telegramChatId: null }, env)).toEqual({
      emailRecipients: ['env@shop.vn'],
      telegram: { botToken: 'token', chatId: '-1' },
    });
    expect(
      resolveAlertChannels(
        { emailRecipients: [], telegramChatId: '-200' },
        { telegramBotToken: null },
      ),
    ).toEqual({ emailRecipients: [], telegram: null });
  });
});

describe('createSenderResolver', () => {
  it('caches the stored sender for the TTL and keeps the last value on errors', async () => {
    let clock = 0;
    let fail = false;
    const { db, where } = fakeDb(async () => {
      if (fail) throw new Error('db down');
      return [{ key: 'email.senderName', value: JSON.stringify('Hương Thơm') }];
    });
    const resolve = createSenderResolver(db, 'Shop <no-reply@shop.vn>', {
      ttlMs: 1000,
      now: () => clock,
    });
    expect(await resolve()).toBe('"Hương Thơm" <no-reply@shop.vn>');
    expect(await resolve()).toBe('"Hương Thơm" <no-reply@shop.vn>');
    expect(where).toHaveBeenCalledTimes(1);
    clock = 2000;
    fail = true;
    expect(await resolve()).toBe('"Hương Thơm" <no-reply@shop.vn>');
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('uses EMAIL_FROM when the first read fails', async () => {
    const { db } = fakeDb(async () => {
      throw new Error('db down');
    });
    expect(await createSenderResolver(db, 'no-reply@shop.vn')()).toBe('no-reply@shop.vn');
  });
});
