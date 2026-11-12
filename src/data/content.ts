import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { getDb } from '@/server/db/client';
import { contentTags } from '@/server/modules/catalog/cache-tags';
import * as content from '@/server/modules/content';
import type { BannerPlacement, Locale } from '@/server/modules/content';
import { settingsTags } from '@/server/modules/settings';

/**
 * Cached storefront reads for content (Next-only layer: 'use cache' + cacheTag, §14.1).
 * Writers expire the tags (Server Actions directly, the worker through `cache.revalidate`).
 *
 * Time-dependent rules (scheduled posts, banner schedules) are applied by the callers at
 * request time, so cached entries never bake in "now".
 *
 * Callers render these behind `await connection()` inside <Suspense>: the database is not
 * available while the Docker image is built, so nothing here may run during prerendering.
 */

export async function getInfoPage(key: string, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.pageList);
  const page = await content.getPublishedPageByKey(getDb(), { key, locale });
  if (page) cacheTag(contentTags.page(page.id));
  return page;
}

export async function getPolicyPage(slug: string, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.pageList);
  const page = await content.getPublishedPolicyBySlug(getDb(), { slug, locale });
  if (page) cacheTag(contentTags.page(page.id));
  return page;
}

export async function getPostSummaries(locale: Locale, topicId?: string) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.postList);
  return content.listPublishedPostSummaries(getDb(), { locale, topicId });
}

export async function getPost(slug: string, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.postList);
  const post = await content.getPublishedPost(getDb(), { slug, locale });
  if (post) cacheTag(contentTags.post(post.id));
  return post;
}

export async function getTopic(slug: string, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.postList);
  return content.getPublishedTopic(getDb(), { slug, locale });
}

export async function getTopics(locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.postList);
  return content.listPublishedTopics(getDb(), locale);
}

export async function getBanners(placement: BannerPlacement, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.banners);
  return content.listActiveBanners(getDb(), { placement, locale });
}

export async function getMenu(key: string, locale: Locale) {
  'use cache';
  cacheLife('max');
  cacheTag(contentTags.menus);
  return content.getMenu(getDb(), { key, locale });
}

/** Seller details live in `settings`; admin → Settings (company) expires the tag on save. */
export async function getSellerInfo() {
  'use cache';
  cacheLife('max');
  cacheTag(settingsTags.company);
  return content.getSellerInfo(getDb());
}

export async function getContentSitemapEntries() {
  'use cache';
  cacheLife('hours');
  cacheTag(contentTags.pageList, contentTags.postList);
  return content.listSitemapEntries(getDb());
}

/** Posts whose publication time has come (scheduled posts stay hidden). */
export function visibleNow<T extends { publishedAt: Date | string }>(items: T[], now = new Date()) {
  return items.filter((item) => new Date(item.publishedAt).getTime() <= now.getTime());
}

/** Banners of a placement whose schedule includes the current request time. */
export async function getLiveBanners(placement: BannerPlacement, locale: Locale) {
  const now = new Date();
  return (await getBanners(placement, locale)).filter((banner) =>
    content.isBannerLive(banner, now),
  );
}
