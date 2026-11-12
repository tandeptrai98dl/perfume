import { inArray, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { settings } from '@/server/db/schema';
import { recordAudit, REDACTED, type AuditDiff } from '@/server/lib/audit';
import {
  assertCan,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
} from '@/server/lib/command-context';

import {
  parseSettingValue,
  REDACTED_SETTING_KEYS,
  SECTION_TAGS,
  SETTING_DEFINITIONS,
  SETTINGS_SECTIONS,
  type SettingKey,
  type SettingsSection,
  type SettingsSectionInput,
  type SettingsSectionValues,
  type SettingValue,
} from './schemas';

/*
 * Settings read side (shared with the worker, ADR-0023) and the only writer of `settings`
 * (admin `/admin/settings`, permission `settings.manage`). Reads never fail on a missing or
 * malformed row: each key falls back to its own default (schemas.ts), so checkout keeps working.
 */

export const SETTINGS_PERMISSION = 'settings.manage' as const;

type Reader = Pick<Database, 'select'>;

/*
 * Values are read as JSON text and parsed here: Drizzle's jsonb mapper re-parses strings the
 * driver already decoded, turning a stored "19001234" or "-100123" into a number.
 */
const rawValue = sql<string>`${settings.value}::text`;
function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type Values<K extends SettingKey> = { [P in K]: SettingValue<P> | null };

/** Typed values of `keys` (missing/invalid rows → default, or `null` for optional keys). */
export async function readSettings<K extends SettingKey>(
  db: Reader,
  keys: readonly K[],
): Promise<Values<K>> {
  const rows = await db
    .select({ key: settings.key, value: rawValue })
    .from(settings)
    .where(inArray(settings.key, [...keys]));
  const byKey = new Map(rows.map((row) => [row.key, decode(row.value)]));
  return Object.fromEntries(
    keys.map((key) => [key, parseSettingValue(key, byKey.get(key))]),
  ) as Values<K>;
}

/** Keys with a default are never `null` after `readSettings`. */
function req<T>(value: T | null): T {
  if (value === null) throw new Error('Setting without default read as required');
  return value;
}

// ---------- Commerce (checkout pricing, COD, reservations, returns) ----------

export type CommerceSettings = {
  cod: { maxOrderWithoutDeposit: number; depositPercent: number; confirmationWindowHours: number };
  checkout: { paymentSessionMinutes: number; onlineReservationMinutes: number };
  cart: { maxQuantityPerLine: number };
  giftWrapFee: number;
  returnsWindowDays: number;
};

const COMMERCE_KEYS = [
  'cod.maxOrderWithoutDeposit',
  'cod.depositPercent',
  'cod.confirmationWindowHours',
  'checkout.paymentSessionMinutes',
  'checkout.onlineReservationMinutes',
  'cart.maxQuantityPerLine',
  'giftWrap.fee',
  'returns.windowDays',
] as const satisfies SettingKey[];

export async function getCommerceSettings(db: Reader): Promise<CommerceSettings> {
  const v = await readSettings(db, COMMERCE_KEYS);
  return {
    cod: {
      maxOrderWithoutDeposit: req(v['cod.maxOrderWithoutDeposit']),
      depositPercent: req(v['cod.depositPercent']),
      confirmationWindowHours: req(v['cod.confirmationWindowHours']),
    },
    checkout: {
      paymentSessionMinutes: req(v['checkout.paymentSessionMinutes']),
      onlineReservationMinutes: req(v['checkout.onlineReservationMinutes']),
    },
    cart: { maxQuantityPerLine: req(v['cart.maxQuantityPerLine']) },
    giftWrapFee: req(v['giftWrap.fee']),
    returnsWindowDays: req(v['returns.windowDays']),
  };
}

// ---------- E-invoicing (D13) ----------

/**
 * VAT rate applied to every invoice line (goods and fees), in percent. Default 10 % (standard
 * rate for perfume/cosmetics) — PENDING ACCOUNTANT CONFIRMATION (ADR-0013): a temporary
 * reduced rate (8 %) may apply in some periods. Prices are VAT-inclusive; the invoice splits
 * each line into taxable amount + VAT. Stored as the `einvoice.vatRatePercent` setting.
 */
export type EinvoiceSettings = { vatRatePercent: number };

export async function getEinvoiceSettings(db: Reader): Promise<EinvoiceSettings> {
  const v = await readSettings(db, ['einvoice.vatRatePercent']);
  return { vatRatePercent: req(v['einvoice.vatRatePercent']) };
}

// ---------- Internal alerts and e-mail sender (worker) ----------

export type AlertChannelSettings = { emailRecipients: string[]; telegramChatId: string | null };

export async function getAlertChannelSettings(db: Reader): Promise<AlertChannelSettings> {
  const v = await readSettings(db, ['alerts.emailRecipients', 'alerts.telegramChatId']);
  return {
    emailRecipients: v['alerts.emailRecipients'] ?? [],
    telegramChatId: v['alerts.telegramChatId'],
  };
}

/**
 * Effective alert channels: settings win, env (`STAFF_ALERT_EMAIL`, `TELEGRAM_CHAT_ID`) is
 * the fallback. The bot token only ever comes from env (ADR-0007), so without it there is no
 * Telegram channel whatever the chat id.
 */
export function resolveAlertChannels(
  stored: AlertChannelSettings,
  env: {
    staffAlertEmail?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  },
): { emailRecipients: string[]; telegram: { botToken: string; chatId: string } | null } {
  const emailRecipients =
    stored.emailRecipients.length > 0
      ? stored.emailRecipients
      : env.staffAlertEmail
        ? [env.staffAlertEmail]
        : [];
  const chatId = stored.telegramChatId ?? env.telegramChatId ?? null;
  return {
    emailRecipients,
    telegram: env.telegramBotToken && chatId ? { botToken: env.telegramBotToken, chatId } : null,
  };
}

export type EmailSenderSettings = { name: string | null; address: string | null };

export async function getEmailSenderSettings(db: Reader): Promise<EmailSenderSettings> {
  const v = await readSettings(db, ['email.senderName', 'email.senderAddress']);
  return { name: v['email.senderName'], address: v['email.senderAddress'] };
}

/**
 * RFC 5322 `From` header: the stored name and/or address replace the matching part of
 * `EMAIL_FROM` (`Name <address>` or a bare address). The address must belong to a domain the
 * SMTP account is allowed to send for (SPF/DKIM), see docs/ops/production-checklist.md.
 */
export function formatSender(stored: EmailSenderSettings, envFrom: string): string {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(envFrom);
  const envName = match?.[1]?.trim() || null;
  const envAddress = (match?.[2] ?? envFrom).trim();
  const name = stored.name ?? envName;
  const address = stored.address ?? envAddress;
  return name ? `"${name.replace(/["\\]/g, '')}" <${address}>` : address;
}

/**
 * Worker-side `From` resolver: re-reads the sender settings at most every `ttlMs`, so a change
 * in admin applies within a minute without a redeploy. A database error keeps the last value
 * (or EMAIL_FROM): e-mails are never blocked by the settings read.
 */
export function createSenderResolver(
  db: Reader,
  envFrom: string,
  options: { ttlMs?: number; now?: () => number } = {},
): () => Promise<string> {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cached: { value: string; at: number } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    try {
      cached = { value: formatSender(await getEmailSenderSettings(db), envFrom), at: now() };
    } catch {
      cached = { value: cached?.value ?? envFrom, at: now() };
    }
    return cached.value;
  };
}

// ---------- SEO defaults (§13.1) ----------

export type SeoDefaults = { title: string | null; description: string | null };

export async function getSeoDefaults(db: Reader, locale: 'vi' | 'en'): Promise<SeoDefaults> {
  const titleKey = `seo.defaultTitle.${locale}` as const;
  const descriptionKey = `seo.defaultDescription.${locale}` as const;
  const v = await readSettings(db, [titleKey, descriptionKey]);
  return { title: v[titleKey], description: v[descriptionKey] };
}

// ---------- Admin ----------

/** Every section's current values for `/admin/settings`. */
export async function getSettingsForAdmin(db: Reader): Promise<SettingsSectionValues> {
  const all = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
  const values = await readSettings(db, all);
  return Object.fromEntries(
    Object.entries(SETTINGS_SECTIONS).map(([section, fields]) => [
      section,
      Object.fromEntries(
        Object.entries(fields as Record<string, SettingKey>).map(([field, key]) => [
          field,
          values[key],
        ]),
      ),
    ]),
  ) as SettingsSectionValues;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Saves one admin section: rows locked `FOR UPDATE`, changed keys upserted (or deleted when an
 * optional value is cleared), one `settings.update` audit row with a per-key diff, and the
 * section's cache tags revalidated through the outbox (the action also revalidates at once).
 * A save without changes writes nothing.
 */
export async function saveSettingsSection(
  ctx: CommandContext,
  input: SettingsSectionInput,
): Promise<CommandResult<{ section: SettingsSection; changedKeys: SettingKey[] }>> {
  assertCan(ctx.actor, SETTINGS_PERMISSION);
  const fields = SETTINGS_SECTIONS[input.section] as Record<string, SettingKey>;
  const next = new Map<SettingKey, unknown>(
    Object.entries(fields).map(([field, key]) => [
      key,
      (input.values as Record<string, unknown>)[field] ?? null,
    ]),
  );
  const keys = [...next.keys()];

  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ key: settings.key, value: rawValue })
      .from(settings)
      .where(inArray(settings.key, keys))
      .for('update');
    const stored = new Map(rows.map((row) => [row.key as SettingKey, decode(row.value)]));

    const diff: AuditDiff = {};
    const upserts: { key: SettingKey; value: unknown }[] = [];
    const deletes: SettingKey[] = [];
    for (const key of keys) {
      const after = next.get(key) ?? null;
      // Effective value: a missing or invalid row reads as its default.
      const from = parseSettingValue(key, stored.get(key));
      if (sameJson(from, after)) continue;
      diff[key] = REDACTED_SETTING_KEYS.has(key)
        ? { from: REDACTED, to: REDACTED }
        : { from, to: after };
      if (after === null) deletes.push(key);
      else upserts.push({ key, value: after });
    }

    const changedKeys = Object.keys(diff) as SettingKey[];
    if (changedKeys.length === 0) {
      return { data: { section: input.section, changedKeys }, tags: [] };
    }

    for (const { key, value } of upserts) {
      await tx
        .insert(settings)
        .values({ key, value, updatedBy: ctx.actor.id })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedBy: ctx.actor.id, updatedAt: new Date() },
        });
    }
    if (deletes.length > 0) await tx.delete(settings).where(inArray(settings.key, deletes));

    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'settings.update',
      entityType: 'settings',
      entityId: input.section,
      diff,
      ip: ctx.ip,
    });
    const tags = await enqueueRevalidation(ctx.boss, tx, SECTION_TAGS[input.section]);
    return { data: { section: input.section, changedKeys }, tags };
  });
}
