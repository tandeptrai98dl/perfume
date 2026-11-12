import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { getDb } from '@/server/db/client';
import type { Locale } from '@/i18n/routing';
import * as settings from '@/server/modules/settings';

/**
 * Cached storefront reads of settings (Next-only layer, §14.1). Admin → Settings expires the
 * section tag on save (Server Action at once, the worker through `cache.revalidate`).
 * Like src/data/content.ts, callers render behind `await connection()`: the database is not
 * available while the Docker image is built.
 */

/** Site-wide default title/description for `locale`; `null` fields fall back to messages. */
export async function getSeoDefaults(locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(settings.settingsTags.seo);
  return settings.getSeoDefaults(getDb(), locale);
}
