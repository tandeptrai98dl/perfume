import { describe, expect, it } from 'vitest';

import {
  parseSettingValue,
  SECTION_TAGS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  settingDefaults,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  settingsSectionSchema,
} from './schemas';

const issueCodes = (raw: unknown) => {
  const result = settingsSectionSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
};

const company = (values: Record<string, unknown> = {}) => ({
  section: 'company',
  values: {
    name: 'Công ty TNHH Hương Thơm',
    taxCode: '0312345678',
    address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
    legalRepresentative: 'Nguyễn Văn A',
    phone: '1900 1234',
    email: 'hello@shop.vn',
    businessRegistration: 'Giấy chứng nhận ĐKDN số 0312345678',
    moitNotificationUrl: 'http://online.gov.vn/Home/WebDetails/12345',
    moitBadgeImageUrl: 'https://online.gov.vn/Content/EndUser/LogoCCDVSaleNoti/logoSaleNoti.png',
    ...values,
  },
});

const checkout = (values: Record<string, unknown> = {}) => ({
  section: 'checkout',
  values: {
    codMaxOrderWithoutDeposit: 5_000_000,
    codDepositPercent: 20,
    codConfirmationWindowHours: 24,
    paymentSessionMinutes: 15,
    onlineReservationMinutes: 30,
    maxQuantityPerLine: 5,
    giftWrapFee: 50_000,
    ...values,
  },
});

describe('settings registry', () => {
  it('maps every key to exactly one section field', () => {
    const mapped = Object.values(SETTINGS_SECTIONS).flatMap((fields) => Object.values(fields));
    expect([...mapped].sort()).toEqual([...SETTING_KEYS].sort());
    expect(new Set(mapped).size).toBe(mapped.length);
    for (const section of SETTINGS_SECTION_IDS)
      expect(SECTION_TAGS[section].length).toBeGreaterThan(0);
  });

  it('keeps the seeded defaults of ADR-0006/0013/0016/0017 and validates them', () => {
    expect(settingDefaults()).toEqual({
      'cod.maxOrderWithoutDeposit': 5_000_000,
      'cod.depositPercent': 20,
      'cod.confirmationWindowHours': 24,
      'checkout.paymentSessionMinutes': 15,
      'checkout.onlineReservationMinutes': 30,
      'cart.maxQuantityPerLine': 5,
      'giftWrap.fee': 50_000,
      'returns.windowDays': 7,
      'einvoice.vatRatePercent': 10,
    });
    for (const [key, value] of Object.entries(settingDefaults())) {
      const def = SETTING_DEFINITIONS[key as keyof typeof SETTING_DEFINITIONS];
      expect(def.schema.safeParse(value).success, key).toBe(true);
    }
  });

  it('falls back per key when a stored value is missing or invalid', () => {
    expect(parseSettingValue('cod.depositPercent', 30)).toBe(30);
    expect(parseSettingValue('cod.depositPercent', 'thirty')).toBe(20);
    expect(parseSettingValue('cod.depositPercent', undefined)).toBe(20);
    expect(parseSettingValue('einvoice.vatRatePercent', 7)).toBe(10);
    expect(parseSettingValue('company.name', null)).toBeNull();
    expect(parseSettingValue('company.moitNotificationUrl', 'javascript:alert(1)')).toBeNull();
  });
});

describe('section schemas', () => {
  it('accepts a complete company section and trims values', () => {
    const parsed = settingsSectionSchema.parse(company({ name: '  Công ty TNHH Hương Thơm  ' }));
    expect(parsed.values).toMatchObject({ name: 'Công ty TNHH Hương Thơm', taxCode: '0312345678' });
  });

  it('turns empty optional fields into null (unset)', () => {
    const parsed = settingsSectionSchema.parse(
      company({ legalRepresentative: '   ', moitNotificationUrl: '', moitBadgeImageUrl: null }),
    );
    expect(parsed.values).toMatchObject({
      legalRepresentative: null,
      moitNotificationUrl: null,
      moitBadgeImageUrl: null,
    });
  });

  it.each([
    ['taxCode', '12345', 'taxCodeInvalid'],
    ['taxCode', '0312345678-001', null],
    ['taxCode', '079123456789', null],
    ['phone', 'call us', 'hotlineInvalid'],
    ['phone', '+84 28 3812 3456', null],
    ['email', 'not-an-email', 'emailInvalid'],
    ['moitNotificationUrl', 'https://example.com/fake-badge', 'moitUrlInvalid'],
    ['moitBadgeImageUrl', 'http://online.gov.vn/logo.png', 'badgeUrlInvalid'],
    ['moitBadgeImageUrl', '//evil.example/logo.png', 'badgeUrlInvalid'],
    ['moitBadgeImageUrl', '/images/moit-badge.png', null],
  ])('company.%s = %j → %s', (field, value, code) => {
    const issues = issueCodes(company({ [field]: value }));
    expect(issues).toEqual(code ? [`values.${field}:${code}`] : []);
  });

  it('refuses a badge image without the notification record', () => {
    expect(issueCodes(company({ moitNotificationUrl: null }))).toEqual([
      'values.moitNotificationUrl:moitUrlRequired',
    ]);
  });

  it('validates checkout ranges and keeps the reservation at least as long as the session', () => {
    expect(issueCodes(checkout())).toEqual([]);
    expect(issueCodes(checkout({ codDepositPercent: 101 }))).toEqual([
      'values.codDepositPercent:tooLarge',
    ]);
    expect(issueCodes(checkout({ giftWrapFee: 1.5 }))).toEqual(['values.giftWrapFee:integer']);
    expect(issueCodes(checkout({ giftWrapFee: null }))).toEqual(['values.giftWrapFee:required']);
    expect(
      issueCodes(checkout({ paymentSessionMinutes: 30, onlineReservationMinutes: 20 })),
    ).toEqual(['values.onlineReservationMinutes:reservationShorterThanSession']);
  });

  it('rejects unknown fields (no writing arbitrary keys)', () => {
    expect(
      issueCodes({ section: 'returns', values: { windowDays: 7, 'vnpay.secret': 'x' } }),
    ).not.toEqual([]);
    expect(issueCodes({ section: 'payments', values: {} })).not.toEqual([]);
  });

  it('keeps returns within 7–30 days and VAT within the accepted rates', () => {
    expect(issueCodes({ section: 'returns', values: { windowDays: 3 } })).toEqual([
      'values.windowDays:tooSmall',
    ]);
    expect(issueCodes({ section: 'einvoice', values: { vatRatePercent: 8 } })).toEqual([]);
    expect(issueCodes({ section: 'einvoice', values: { vatRatePercent: 7 } })).toEqual([
      'values.vatRatePercent:vatRateInvalid',
    ]);
  });

  it('normalises alert recipients and validates the Telegram chat id', () => {
    const parsed = settingsSectionSchema.parse({
      section: 'alerts',
      values: {
        emailRecipients: ['Ops@Shop.vn', 'ops@shop.vn', 'owner@shop.vn'],
        telegramChatId: '-1001234567890',
      },
    });
    expect(parsed.values).toEqual({
      emailRecipients: ['ops@shop.vn', 'owner@shop.vn'],
      telegramChatId: '-1001234567890',
    });
    expect(
      settingsSectionSchema.parse({
        section: 'alerts',
        values: { emailRecipients: [], telegramChatId: '' },
      }).values,
    ).toEqual({ emailRecipients: null, telegramChatId: null });
    expect(
      issueCodes({
        section: 'alerts',
        values: { emailRecipients: ['a@shop.vn', 'nope'], telegramChatId: 'my group' },
      }),
    ).toEqual([
      'values.emailRecipients.1:emailInvalid',
      'values.telegramChatId:telegramChatIdInvalid',
    ]);
    expect(
      issueCodes({
        section: 'alerts',
        values: {
          emailRecipients: Array.from({ length: 6 }, (_, i) => `a${i}@shop.vn`),
          telegramChatId: null,
        },
      }),
    ).toEqual(['values.emailRecipients:tooMany']);
  });

  it('limits SEO texts and refuses header injection in the sender name', () => {
    expect(
      issueCodes({
        section: 'seo',
        values: {
          titleVi: 'x'.repeat(71),
          titleEn: null,
          descriptionVi: null,
          descriptionEn: null,
        },
      }),
    ).toEqual(['values.titleVi:tooLong']);
    expect(
      issueCodes({
        section: 'email',
        values: { senderName: 'Shop <evil@x.vn>', senderAddress: 'no-reply@shop.vn' },
      }),
    ).toEqual(['values.senderName:invalid']);
  });
});
