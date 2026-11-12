'use server';

import 'server-only';

import {
  saveSettingsSection,
  SETTINGS_PERMISSION,
  settingsSectionSchema,
} from '@/server/modules/settings';

import { runAdminAction } from './run';

/* /admin/settings (§11.2 Settings): one section per save; Owner only (`settings.manage`). */

export async function saveSettingsSectionAction(raw: unknown) {
  return runAdminAction(settingsSectionSchema, raw, SETTINGS_PERMISSION, saveSettingsSection);
}
