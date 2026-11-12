/**
 * Settings module public API (§11.2 Settings). Typed operational settings, never secrets
 * (ADR-0007); `saveSettingsSection` is the only writer of the `settings` table.
 */
export {
  EINVOICE_VAT_RATES,
  MAX_ALERT_RECIPIENTS,
  parseSettingValue,
  SECTION_TAGS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  settingDefaults,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  settingsSectionSchema,
  settingsTags,
  type SettingKey,
  type SettingsSection,
  type SettingsSectionInput,
  type SettingsSectionValues,
  type SettingValue,
} from './schemas';
export {
  createSenderResolver,
  formatSender,
  getAlertChannelSettings,
  getCommerceSettings,
  getEinvoiceSettings,
  getEmailSenderSettings,
  getSeoDefaults,
  getSettingsForAdmin,
  readSettings,
  resolveAlertChannels,
  saveSettingsSection,
  SETTINGS_PERMISSION,
  type AlertChannelSettings,
  type CommerceSettings,
  type EinvoiceSettings,
  type EmailSenderSettings,
  type SeoDefaults,
} from './service';
