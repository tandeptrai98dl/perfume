import { and, eq, inArray } from 'drizzle-orm';

import { docFromBlocks } from '@/lib/rich-text';
import { localizedPath } from '@/lib/seo/paths';
import { newId } from '@/server/lib/ids';

import type { Database } from '../client';
import { navigationMenus, pageTranslations, pages } from '../schema';
import { LEGAL_PAGES, type LegalPageSeed } from './legal-drafts';

/*
 * Base (production-safe) seed of the policy pages (§5.1, §1.5) and the footer "legal" menu.
 * Insert-only and idempotent: a page whose key already exists is never touched, so wording an
 * editor changed (or approved with the lawyer) survives every re-run; a policy page that was
 * deleted is re-created, because the law requires it to be published. A page whose slug is
 * already used by another page is skipped and reported instead of failing the seed.
 */

export type LegalSeedResult = { created: string[]; skipped: string[]; conflicts: string[] };

class SlugConflict extends Error {}

async function insertLegalPage(db: Database, page: LegalPageSeed): Promise<boolean> {
  return db.transaction(async (tx) => {
    const id = newId();
    const inserted = await tx
      .insert(pages)
      .values({ id, key: page.key, status: 'active' })
      .onConflictDoNothing({ target: pages.key })
      .returning({ id: pages.id });
    if (inserted.length === 0) return false;

    const translations = [
      { locale: 'vi' as const, ...page.vi, published: true },
      { locale: 'en' as const, ...page.en },
    ];
    for (const t of translations) {
      const row = await tx
        .insert(pageTranslations)
        .values({
          pageId: id,
          locale: t.locale,
          title: t.title,
          slug: t.slug,
          seoDescription: t.description,
          content: docFromBlocks(t.blocks),
          isPublished: t.published,
        })
        .onConflictDoNothing()
        .returning({ pageId: pageTranslations.pageId });
      // Vietnamese is required (ADR-0021); a taken English slug only drops the English draft.
      if (row.length === 0 && t.locale === 'vi') throw new SlugConflict(page.key);
    }
    return true;
  });
}

export async function seedLegalPages(db: Database): Promise<LegalSeedResult> {
  const result: LegalSeedResult = { created: [], skipped: [], conflicts: [] };
  for (const page of LEGAL_PAGES) {
    try {
      if (await insertLegalPage(db, page)) result.created.push(page.key);
      else result.skipped.push(page.key);
    } catch (error) {
      if (!(error instanceof SlugConflict)) throw error;
      result.conflicts.push(page.key);
    }
  }
  await seedLegalMenu(db);
  return result;
}

/**
 * Footer "legal" menu (vi + en) linking the policy pages that exist and are published in that
 * locale. Created once per locale; an existing menu (edited in admin → Navigation) is kept.
 */
async function seedLegalMenu(db: Database): Promise<void> {
  const keys = LEGAL_PAGES.map((page) => page.key);
  const rows = await db
    .select({
      key: pages.key,
      locale: pageTranslations.locale,
      title: pageTranslations.title,
      slug: pageTranslations.slug,
    })
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        inArray(pages.key, keys),
        eq(pages.status, 'active'),
        eq(pageTranslations.isPublished, true),
      ),
    );
  for (const locale of ['vi', 'en'] as const) {
    const items = keys.flatMap((key) => {
      const row = rows.find((r) => r.key === key && r.locale === locale);
      return row
        ? [
            {
              id: key,
              label: row.title,
              href: localizedPath(locale, '/policies/[slug]', { slug: row.slug }),
            },
          ]
        : [];
    });
    await db
      .insert(navigationMenus)
      .values({ key: 'legal', locale, items })
      .onConflictDoNothing({ target: [navigationMenus.key, navigationMenus.locale] });
  }
}
