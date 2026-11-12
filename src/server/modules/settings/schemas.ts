import { z } from 'zod';

/*
 * Settings registry (§11.2 Settings, ADR-0007): one typed Zod schema per `settings.key`, its
 * default (when the shop cannot run without one) and the admin section that edits it. Nothing
 * here is a secret: payment keys, SMTP credentials and the Telegram bot token stay in env.
 * Custom error messages are translation codes (`admin.errors.<code>`).
 */

// ---------- Value helpers ----------

const int = (min: number, max: number) =>
  z
    .number({ error: 'required' })
    .int({ error: 'integer' })
    .min(min, { error: 'tooSmall' })
    .max(max, { error: 'tooLarge' });

const text = (max: number) =>
  z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .max(max, { error: 'tooLong' });

const ONLINE_GOV_HOSTS = new Set(['online.gov.vn', 'www.online.gov.vn']);

function isOnlineGovUrl(value: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && ONLINE_GOV_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** VAT rates the e-invoice adapters accept (ADR-0013; the accountant confirms the rate). */
export const EINVOICE_VAT_RATES = [0, 5, 8, 10] as const;

/** Upper bound on alert e-mail recipients (each one gets its own e-mail). */
export const MAX_ALERT_RECIPIENTS = 5;

type SettingDefinition<S extends z.ZodType = z.ZodType> = {
  schema: S;
  /** Value used when the row is missing or invalid; `null` = optional (absent means unset). */
  default: z.output<S> | null;
};

const required = <S extends z.ZodType>(schema: S, value: z.output<S>): SettingDefinition<S> => ({
  schema,
  default: value,
});
const optional = <S extends z.ZodType>(schema: S): SettingDefinition<S> => ({
  schema,
  default: null,
});

// ---------- Registry ----------

export const SETTING_DEFINITIONS = {
  // Seller information (§1.5, footer + contact page; E-commerce Law 122/2025).
  'company.name': optional(text(200)),
  /** MST: 10 digits, 10-3 for a branch, or a 12-digit personal number (household business). */
  'company.taxCode': optional(
    text(14).regex(/^(\d{10}(-\d{3})?|\d{12})$/, { error: 'taxCodeInvalid' }),
  ),
  'company.address': optional(text(300)),
  'company.legalRepresentative': optional(text(120)),
  /** Hotline: digits with optional +, spaces, dots, dashes or brackets (1900/1800 numbers too). */
  'company.phone': optional(text(20).regex(/^\+?[\d .()-]{6,20}$/, { error: 'hotlineInvalid' })),
  'company.email': optional(
    z
      .string({ error: 'required' })
      .trim()
      .max(254, { error: 'tooLong' })
      .pipe(z.email({ error: 'emailInvalid' })),
  ),
  /** Business licence line as printed (number, date, issuing office). */
  'company.businessRegistration': optional(text(300)),
  /** The shop's record on online.gov.vn (notified-website badge links to it). */
  'company.moitNotificationUrl': optional(
    text(500).refine((value) => isOnlineGovUrl(value, ['https:', 'http:']), {
      error: 'moitUrlInvalid',
    }),
  ),
  /** Official badge image: online.gov.vn (allowed by the CSP) or a file served by the site. */
  'company.moitBadgeImageUrl': optional(
    text(500).refine((value) => isOnlineGovUrl(value, ['https:']) || /^\/(?!\/)\S*$/.test(value), {
      error: 'badgeUrlInvalid',
    }),
  ),

  // Checkout, COD and reservations (ADR-0006, ADR-0016).
  'cod.maxOrderWithoutDeposit': required(int(0, 1_000_000_000), 5_000_000),
  'cod.depositPercent': required(int(0, 100), 20),
  'cod.confirmationWindowHours': required(int(1, 168), 24),
  'checkout.paymentSessionMinutes': required(int(5, 60), 15),
  'checkout.onlineReservationMinutes': required(int(10, 240), 30),
  'cart.maxQuantityPerLine': required(int(1, 50), 5),
  'giftWrap.fee': required(int(0, 1_000_000), 50_000),

  // Returns (ADR-0017): 7 days is the published minimum; longer windows are allowed.
  'returns.windowDays': required(int(7, 30), 7),

  // E-invoicing (ADR-0013): PENDING ACCOUNTANT CONFIRMATION.
  'einvoice.vatRatePercent': required(
    z
      .number({ error: 'required' })
      .int({ error: 'vatRateInvalid' })
      .refine((rate) => (EINVOICE_VAT_RATES as readonly number[]).includes(rate), {
        error: 'vatRateInvalid',
      }),
    10,
  ),

  // Internal alerts (ADR-0019). Settings win over STAFF_ALERT_EMAIL / TELEGRAM_CHAT_ID.
  'alerts.emailRecipients': optional(
    z
      .array(
        z
          .string()
          .trim()
          .max(254, { error: 'tooLong' })
          .pipe(z.email({ error: 'emailInvalid' })),
      )
      .min(1, { error: 'required' })
      .max(MAX_ALERT_RECIPIENTS, { error: 'tooMany' })
      .transform((emails) => [...new Set(emails.map((email) => email.toLowerCase()))]),
  ),
  /** Numeric chat id (groups are negative) or a public @channel name. */
  'alerts.telegramChatId': optional(
    text(64).regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, { error: 'telegramChatIdInvalid' }),
  ),

  // SEO defaults (§13.1): site-wide title and description per locale; messages are the fallback.
  'seo.defaultTitle.vi': optional(text(70)),
  'seo.defaultTitle.en': optional(text(70)),
  'seo.defaultDescription.vi': optional(text(170)),
  'seo.defaultDescription.en': optional(text(170)),

  // Transactional e-mail sender (the SMTP account and DKIM stay in env). Defaults to EMAIL_FROM.
  'email.senderName': optional(text(80).regex(/^[^<>"\r\n]+$/, { error: 'invalid' })),
  'email.senderAddress': optional(
    z
      .string({ error: 'required' })
      .trim()
      .max(254, { error: 'tooLong' })
      .pipe(z.email({ error: 'emailInvalid' })),
  ),
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.output<
  (typeof SETTING_DEFINITIONS)[K]['schema']
>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

/** Rows the base seed writes (keys with a default). Optional keys stay absent until set. */
export function settingDefaults(): Partial<Record<SettingKey, unknown>> {
  return Object.fromEntries(
    Object.entries(SETTING_DEFINITIONS)
      .filter(([, def]) => def.default !== null)
      .map(([key, def]) => [key, def.default]),
  );
}

/** Parses a stored value; a missing or invalid row falls back to the key's default. */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
): SettingValue<K> | null {
  const def = SETTING_DEFINITIONS[key] as SettingDefinition;
  if (raw === undefined || raw === null) return def.default as SettingValue<K> | null;
  const parsed = def.schema.safeParse(raw);
  return parsed.success
    ? (parsed.data as SettingValue<K>)
    : (def.default as SettingValue<K> | null);
}

// ---------- Admin sections ----------

/** Form field → settings key, per admin tab. Each save writes only its own section. */
export const SETTINGS_SECTIONS = {
  company: {
    name: 'company.name',
    taxCode: 'company.taxCode',
    address: 'company.address',
    legalRepresentative: 'company.legalRepresentative',
    phone: 'company.phone',
    email: 'company.email',
    businessRegistration: 'company.businessRegistration',
    moitNotificationUrl: 'company.moitNotificationUrl',
    moitBadgeImageUrl: 'company.moitBadgeImageUrl',
  },
  checkout: {
    codMaxOrderWithoutDeposit: 'cod.maxOrderWithoutDeposit',
    codDepositPercent: 'cod.depositPercent',
    codConfirmationWindowHours: 'cod.confirmationWindowHours',
    paymentSessionMinutes: 'checkout.paymentSessionMinutes',
    onlineReservationMinutes: 'checkout.onlineReservationMinutes',
    maxQuantityPerLine: 'cart.maxQuantityPerLine',
    giftWrapFee: 'giftWrap.fee',
  },
  returns: { windowDays: 'returns.windowDays' },
  einvoice: { vatRatePercent: 'einvoice.vatRatePercent' },
  alerts: {
    emailRecipients: 'alerts.emailRecipients',
    telegramChatId: 'alerts.telegramChatId',
  },
  seo: {
    titleVi: 'seo.defaultTitle.vi',
    titleEn: 'seo.defaultTitle.en',
    descriptionVi: 'seo.defaultDescription.vi',
    descriptionEn: 'seo.defaultDescription.en',
  },
  email: { senderName: 'email.senderName', senderAddress: 'email.senderAddress' },
} as const satisfies Record<string, Record<string, SettingKey>>;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const SETTINGS_SECTION_IDS = Object.keys(SETTINGS_SECTIONS) as SettingsSection[];

/**
 * Cache tag per section, revalidated on save (immediately + outbox). `settings:company` is
 * the footer/contact seller block; `settings:commerce` covers cached reads of checkout
 * pricing inputs (cart and checkout read them live today); `settings:seo` the layout metadata.
 */
export const settingsTags = {
  company: 'settings:company',
  commerce: 'settings:commerce',
  returns: 'settings:returns',
  einvoice: 'settings:einvoice',
  alerts: 'settings:alerts',
  seo: 'settings:seo',
  email: 'settings:email',
} as const;

export const SECTION_TAGS: Record<SettingsSection, string[]> = {
  company: [settingsTags.company],
  checkout: [settingsTags.commerce],
  returns: [settingsTags.returns, settingsTags.commerce],
  einvoice: [settingsTags.einvoice],
  alerts: [settingsTags.alerts],
  seo: [settingsTags.seo],
  email: [settingsTags.email],
};

/** Empty strings and empty lists from the form mean "unset" for optional keys. */
function emptyToNull(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) {
    const items = value.filter((item) => !(typeof item === 'string' && item.trim() === ''));
    return items.length === 0 ? null : items;
  }
  return value;
}

type SectionShape<S extends SettingsSection> = {
  [F in keyof (typeof SETTINGS_SECTIONS)[S]]: z.ZodType<
    SettingValue<(typeof SETTINGS_SECTIONS)[S][F] & SettingKey> | null,
    unknown
  >;
};

function sectionValuesSchema<S extends SettingsSection>(section: S) {
  const fields = SETTINGS_SECTIONS[section] as Record<string, SettingKey>;
  const shape = Object.fromEntries(
    Object.entries(fields).map(([field, key]) => {
      const def = SETTING_DEFINITIONS[key] as SettingDefinition;
      const schema =
        def.default === null ? z.preprocess(emptyToNull, def.schema.nullable()) : def.schema;
      return [field, schema];
    }),
  ) as SectionShape<S>;
  return z.strictObject(shape);
}

const checkoutValues = sectionValuesSchema('checkout').superRefine((values, ctx) => {
  // ADR-0006: customers retry payment while the stock is still held.
  const session = values.paymentSessionMinutes as number;
  const reservation = values.onlineReservationMinutes as number;
  if (reservation < session) {
    ctx.addIssue({
      code: 'custom',
      path: ['onlineReservationMinutes'],
      message: 'reservationShorterThanSession',
    });
  }
});

const companyValues = sectionValuesSchema('company').superRefine((values, ctx) => {
  // A badge without the record it proves would mislead buyers.
  if (values.moitBadgeImageUrl && !values.moitNotificationUrl) {
    ctx.addIssue({ code: 'custom', path: ['moitNotificationUrl'], message: 'moitUrlRequired' });
  }
});

export const settingsSectionSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('company'), values: companyValues }),
  z.object({ section: z.literal('checkout'), values: checkoutValues }),
  z.object({ section: z.literal('returns'), values: sectionValuesSchema('returns') }),
  z.object({ section: z.literal('einvoice'), values: sectionValuesSchema('einvoice') }),
  z.object({ section: z.literal('alerts'), values: sectionValuesSchema('alerts') }),
  z.object({ section: z.literal('seo'), values: sectionValuesSchema('seo') }),
  z.object({ section: z.literal('email'), values: sectionValuesSchema('email') }),
]);

export type SettingsSectionInput = z.output<typeof settingsSectionSchema>;

/** Current values of every section for the admin forms (`null` = not set). */
export type SettingsSectionValues = {
  [S in SettingsSection]: {
    [F in keyof (typeof SETTINGS_SECTIONS)[S]]: SettingValue<
      (typeof SETTINGS_SECTIONS)[S][F] & SettingKey
    > | null;
  };
};

/** Keys whose values are personal data: audit diffs record that they changed, not the values. */
export const REDACTED_SETTING_KEYS: ReadonlySet<SettingKey> = new Set(['alerts.emailRecipients']);
