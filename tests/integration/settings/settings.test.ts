import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, settings } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import {
  getAlertChannelSettings,
  getCommerceSettings,
  getEinvoiceSettings,
  getSettingsForAdmin,
  saveSettingsSection,
  settingsSectionSchema,
} from '@/server/modules/settings';
import { getSellerInfo } from '@/server/modules/content';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

let h: CommandHarness;

beforeAll(async () => {
  h = await startCommandHarness();
});

afterAll(async () => {
  await h?.stop();
});

const parse = (raw: unknown) => settingsSectionSchema.parse(raw);

async function auditRows(section: string) {
  return h.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'settings'), eq(auditLogs.entityId, section)));
}

describe('saveSettingsSection', () => {
  it('saves company info, audits the diff and enqueues the footer revalidation', async () => {
    const input = parse({
      section: 'company',
      values: {
        name: 'Công ty TNHH Hương Thơm',
        taxCode: '0312345678',
        address: '12 Lê Lợi, TP. Hồ Chí Minh',
        legalRepresentative: null,
        phone: '1900 1234',
        email: 'hello@shop.vn',
        businessRegistration: null,
        moitNotificationUrl: 'http://online.gov.vn/Home/WebDetails/12345',
        moitBadgeImageUrl: '/moit-badge.png',
      },
    });
    const result = await saveSettingsSection(h.ctx('owner'), input);
    expect(result.tags).toEqual(['settings:company']);
    expect(result.data.changedKeys).toHaveLength(7);

    const seller = await getSellerInfo(h.db);
    expect(seller).toMatchObject({
      companyName: 'Công ty TNHH Hương Thơm',
      taxCode: '0312345678',
      legalRepresentative: null,
      moitNotificationUrl: 'http://online.gov.vn/Home/WebDetails/12345',
      moitBadgeImageUrl: '/moit-badge.png',
    });

    const [audit] = await auditRows('company');
    expect(audit).toMatchObject({ actorId: h.actorIds.owner, action: 'settings.update' });
    expect(audit!.diff).toMatchObject({
      'company.name': { from: null, to: 'Công ty TNHH Hương Thơm' },
      'company.taxCode': { from: null, to: '0312345678' },
    });
    expect(audit!.diff).not.toHaveProperty('company.legalRepresentative');

    const jobs = await h.jobs('cache.revalidate');
    expect(jobs.at(-1)!.data.tags).toEqual(['settings:company']);

    const [row] = await h.db.select().from(settings).where(eq(settings.key, 'company.name'));
    expect(row!.updatedBy).toBe(h.actorIds.owner);
  });

  it('writes nothing when the section did not change', async () => {
    const before = (await auditRows('company')).length;
    const jobsBefore = (await h.jobs('cache.revalidate')).length;
    const current = await getSettingsForAdmin(h.db);
    const result = await saveSettingsSection(
      h.ctx('owner'),
      parse({ section: 'company', values: current.company }),
    );
    expect(result).toEqual({ data: { section: 'company', changedKeys: [] }, tags: [] });
    expect(await auditRows('company')).toHaveLength(before);
    expect(await h.jobs('cache.revalidate')).toHaveLength(jobsBefore);
  });

  it('clears an optional value by deleting its row', async () => {
    const current = await getSettingsForAdmin(h.db);
    await saveSettingsSection(
      h.ctx('owner'),
      parse({
        section: 'company',
        values: { ...current.company, moitBadgeImageUrl: '', phone: '' },
      }),
    );
    const rows = await h.db.select({ key: settings.key }).from(settings);
    expect(rows.map((r) => r.key)).not.toContain('company.moitBadgeImageUrl');
    expect((await getSellerInfo(h.db)).phone).toBeNull();
    const audits = await auditRows('company');
    expect(audits.at(-1)!.diff).toEqual({
      'company.phone': { from: '1900 1234', to: null },
      'company.moitBadgeImageUrl': { from: '/moit-badge.png', to: null },
    });
  });

  it('keeps digit-only values as strings (hotline, tax code, chat id)', async () => {
    const current = await getSettingsForAdmin(h.db);
    await saveSettingsSection(
      h.ctx('owner'),
      parse({
        section: 'company',
        values: { ...current.company, phone: '19001234', taxCode: '3012345678' },
      }),
    );
    expect(await getSellerInfo(h.db)).toMatchObject({ phone: '19001234', taxCode: '3012345678' });
    expect((await getSettingsForAdmin(h.db)).company.phone).toBe('19001234');
  });

  it('changes checkout pricing inputs read by checkout (defaults when unset)', async () => {
    expect((await getCommerceSettings(h.db)).giftWrapFee).toBe(50_000);
    const result = await saveSettingsSection(
      h.ctx('owner'),
      parse({
        section: 'checkout',
        values: {
          codMaxOrderWithoutDeposit: 8_000_000,
          codDepositPercent: 30,
          codConfirmationWindowHours: 24,
          paymentSessionMinutes: 15,
          onlineReservationMinutes: 30,
          maxQuantityPerLine: 5,
          giftWrapFee: 30_000,
        },
      }),
    );
    expect(result.tags).toEqual(['settings:commerce']);
    // Only the values that differ from the defaults are written and audited.
    expect(result.data.changedKeys.sort()).toEqual([
      'cod.depositPercent',
      'cod.maxOrderWithoutDeposit',
      'giftWrap.fee',
    ]);
    const commerce = await getCommerceSettings(h.db);
    expect(commerce.cod).toMatchObject({ maxOrderWithoutDeposit: 8_000_000, depositPercent: 30 });
    expect(commerce.giftWrapFee).toBe(30_000);
  });

  it('saves the VAT rate and redacts alert recipients in the audit log', async () => {
    await saveSettingsSection(
      h.ctx('owner'),
      parse({ section: 'einvoice', values: { vatRatePercent: 8 } }),
    );
    expect(await getEinvoiceSettings(h.db)).toEqual({ vatRatePercent: 8 });

    await saveSettingsSection(
      h.ctx('owner'),
      parse({
        section: 'alerts',
        values: { emailRecipients: ['ops@shop.vn'], telegramChatId: '-100123' },
      }),
    );
    expect(await getAlertChannelSettings(h.db)).toEqual({
      emailRecipients: ['ops@shop.vn'],
      telegramChatId: '-100123',
    });
    const [audit] = await auditRows('alerts');
    expect(audit!.diff).toEqual({
      'alerts.emailRecipients': { from: '[redacted]', to: '[redacted]' },
      'alerts.telegramChatId': { from: null, to: '-100123' },
    });
  });

  it('is Owner-only (settings.manage)', async () => {
    for (const role of ['manager', 'staff', 'editor'] as const) {
      await expect(
        saveSettingsSection(h.ctx(role), parse({ section: 'returns', values: { windowDays: 10 } })),
      ).rejects.toBeInstanceOf(DomainError);
    }
    expect((await getCommerceSettings(h.db)).returnsWindowDays).toBe(7);
  });

  it('falls back to defaults for a malformed stored value', async () => {
    await h.db
      .insert(settings)
      .values({ key: 'returns.windowDays', value: 'seven' })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'seven' } });
    expect((await getCommerceSettings(h.db)).returnsWindowDays).toBe(7);
    const result = await saveSettingsSection(
      h.ctx('owner'),
      parse({ section: 'returns', values: { windowDays: 14 } }),
    );
    expect(result.tags).toEqual(['settings:returns', 'settings:commerce']);
    expect((await getCommerceSettings(h.db)).returnsWindowDays).toBe(14);
  });
});
