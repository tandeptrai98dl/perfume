import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import {
  bannerTranslations,
  banners,
  navigationMenus,
  pageTranslations,
  pages,
  postProducts,
  postTags,
  postTranslations,
  posts,
  redirects,
  tagTranslations,
  tags,
} from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import { writeAuditLog } from '@/server/lib/audit';
import { newId } from '@/server/lib/ids';
import { contentTags } from '@/server/modules/catalog/cache-tags';

import { pagePath, postPath, topicPath } from './paths';
import type { DbExecutor } from './queries';
import { planRedirect, type RedirectRow } from './redirects';
import {
  bannerInputSchema,
  idSchema,
  menuInputSchema,
  pageInputSchema,
  postInputSchema,
  redirectInputSchema,
  topicInputSchema,
} from './schemas';
import {
  LOCALES,
  type Actor,
  type Locale,
  type RedirectRule,
  type RedirectStatusCode,
} from './types';

/**
 * Content writes. Each command validates with Zod, runs in one transaction, writes an audit
 * entry and enqueues `cache.revalidate` (transactional outbox, ADR-0023). Commands return the
 * cache tags they touched so Server Actions can also expire them immediately.
 */

export type ContentDeps = { db: Database; boss: PgBoss };

export type ContentErrorCode = 'not_found' | 'slug_taken' | 'key_taken' | 'redirect_exists';

export class ContentError extends Error {
  constructor(
    public readonly code: ContentErrorCode,
    public readonly field?: string,
  ) {
    super(`Content error: ${code}`);
    this.name = 'ContentError';
  }
}

export type CommandResult = { id: string; tags: string[] };

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505') return pg.constraint ?? 'unique';
  }
  return null;
}

/** Runs `work` in a transaction and maps unique violations to `ContentError`s. */
async function transact<T>(
  db: Database,
  work: (tx: Tx) => Promise<T>,
  onUnique: (constraint: string) => ContentError,
): Promise<T> {
  try {
    return await db.transaction(work);
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint) throw onUnique(constraint);
    throw error;
  }
}

async function revalidate(deps: ContentDeps, tx: Tx, tags: string[]) {
  const unique = [...new Set(tags)];
  await enqueue(deps.boss, tx, 'cache.revalidate', { tags: unique, expire: 'max' });
  return unique;
}

// ---------- Redirects ----------

/**
 * Inserts or updates `fromPath → toPath` inside the caller's transaction, collapsing chains
 * and loops (see `planRedirect`). Other modules (e.g. catalogue slug changes) call this and add
 * `contentTags.redirects` to their own `cache.revalidate` job.
 */
export async function createRedirect(
  tx: DbExecutor,
  input: { fromPath: string; toPath: string; statusCode?: number },
): Promise<RedirectRule> {
  const parsed = redirectInputSchema.parse(input);
  const statusCode = parsed.statusCode as RedirectStatusCode;
  const select = { id: redirects.id, fromPath: redirects.fromPath, toPath: redirects.toPath };

  const relevant = new Map<string, RedirectRow>();
  const add = (rows: RedirectRow[]) => rows.forEach((row) => relevant.set(row.id, row));
  add(
    await tx
      .select(select)
      .from(redirects)
      .where(or(eq(redirects.toPath, parsed.fromPath), eq(redirects.fromPath, parsed.fromPath))),
  );
  // Follow the target through existing rules (normally at most one hop: chains are collapsed).
  let cursor = parsed.toPath;
  for (let i = 0; i < 20; i += 1) {
    const [next] = await tx.select(select).from(redirects).where(eq(redirects.fromPath, cursor));
    if (!next || relevant.has(next.id)) break;
    add([next]);
    cursor = next.toPath;
  }

  const plan = planRedirect([...relevant.values()], { ...parsed, statusCode });
  if (plan.remove.length) await tx.delete(redirects).where(inArray(redirects.id, plan.remove));
  if (plan.repoint.length) {
    await tx
      .update(redirects)
      .set({ toPath: plan.upsert.toPath })
      .where(inArray(redirects.id, plan.repoint));
  }
  const [row] = await tx
    .insert(redirects)
    .values({ id: newId(), ...plan.upsert })
    .onConflictDoUpdate({
      target: redirects.fromPath,
      set: {
        toPath: plan.upsert.toPath,
        statusCode: plan.upsert.statusCode,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { ...row!, statusCode: row!.statusCode as RedirectStatusCode };
}

/** A URL that now serves live content must not redirect away. */
async function releasePaths(tx: DbExecutor, paths: string[]) {
  if (paths.length) await tx.delete(redirects).where(inArray(redirects.fromPath, paths));
}

export async function createRedirectCommand(
  deps: ContentDeps,
  actor: Actor,
  input: unknown,
): Promise<CommandResult> {
  const parsed = redirectInputSchema.parse(input);
  return transact(
    deps.db,
    async (tx) => {
      const rule = await createRedirect(tx, parsed);
      await writeAuditLog(tx, {
        actorId: actor.id,
        ip: actor.ip,
        action: 'content.redirect.save',
        entityType: 'redirect',
        entityId: rule.id,
        diff: { fromPath: rule.fromPath, toPath: rule.toPath, statusCode: rule.statusCode },
      });
      return { id: rule.id, tags: await revalidate(deps, tx, [contentTags.redirects]) };
    },
    () => new ContentError('redirect_exists', 'fromPath'),
  );
}

export async function deleteRedirect(
  deps: ContentDeps,
  actor: Actor,
  id: unknown,
): Promise<CommandResult> {
  const redirectId = idSchema.parse(id);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.delete(redirects).where(eq(redirects.id, redirectId)).returning();
    if (!row) throw new ContentError('not_found');
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.redirect.delete',
      entityType: 'redirect',
      entityId: row.id,
      diff: { fromPath: row.fromPath, toPath: row.toPath },
    });
    return { id: row.id, tags: await revalidate(deps, tx, [contentTags.redirects]) };
  });
}

/**
 * Adds proxy hit counts (`path → hits`). Raw SQL on purpose: it must not bump `updated_at`,
 * which feeds the route table version.
 */
export async function recordRedirectHits(db: DbExecutor, hits: Map<string, number>) {
  if (hits.size === 0) return;
  const values = sql.join(
    [...hits].map(([path, n]) => sql`(${path}, ${n}::int)`),
    sql`, `,
  );
  await db.execute(sql`
    update redirects r set hit_count = r.hit_count + v.n, last_hit_at = now()
    from (values ${values}) as v(path, n)
    where r.from_path = v.path`);
}

/**
 * Old → new public paths per locale for an entity whose slug (or key) changed. A redirect is
 * only needed when the old URL was live and the new translation exists.
 */
async function redirectChangedPaths(
  tx: Tx,
  changes: { oldPath: string | null; newPath: string | null }[],
): Promise<number> {
  let created = 0;
  for (const change of changes) {
    if (change.oldPath && change.newPath && change.oldPath !== change.newPath) {
      await createRedirect(tx, {
        fromPath: change.oldPath,
        toPath: change.newPath,
        statusCode: 301,
      });
      created += 1;
    }
  }
  return created;
}

// ---------- Pages ----------

export async function savePage(
  deps: ContentDeps,
  actor: Actor,
  raw: unknown,
): Promise<CommandResult> {
  const input = pageInputSchema.parse(raw);
  return transact(
    deps.db,
    async (tx) => {
      const id = input.id ?? newId();
      let before: { key: string; status: string } | null = null;
      let beforeTranslations: { locale: Locale; slug: string; isPublished: boolean }[] = [];
      if (input.id) {
        const [row] = await tx
          .select({ key: pages.key, status: pages.status })
          .from(pages)
          .where(eq(pages.id, id))
          .for('update');
        if (!row) throw new ContentError('not_found');
        before = row;
        beforeTranslations = await tx
          .select({
            locale: pageTranslations.locale,
            slug: pageTranslations.slug,
            isPublished: pageTranslations.isPublished,
          })
          .from(pageTranslations)
          .where(eq(pageTranslations.pageId, id));
        await tx
          .update(pages)
          .set({ key: input.key, status: input.status })
          .where(eq(pages.id, id));
      } else {
        await tx.insert(pages).values({ id, key: input.key, status: input.status });
      }

      for (const locale of LOCALES) {
        const t = input.translations[locale];
        if (!t) {
          await tx
            .delete(pageTranslations)
            .where(and(eq(pageTranslations.pageId, id), eq(pageTranslations.locale, locale)));
          continue;
        }
        await tx
          .insert(pageTranslations)
          .values({ pageId: id, locale, ...t })
          .onConflictDoUpdate({
            target: [pageTranslations.pageId, pageTranslations.locale],
            set: { ...t, updatedAt: new Date() },
          });
      }

      const live = input.status === 'active';
      const redirectCount = await redirectChangedPaths(
        tx,
        LOCALES.map((locale) => {
          const old = beforeTranslations.find((t) => t.locale === locale);
          const next = input.translations[locale];
          return {
            oldPath:
              before?.status === 'active' && old?.isPublished
                ? pagePath(before.key, old.slug, locale)
                : null,
            newPath: next ? pagePath(input.key, next.slug, locale) : null,
          };
        }),
      );
      if (live) {
        await releasePaths(
          tx,
          LOCALES.flatMap((locale) => {
            const t = input.translations[locale];
            return t?.isPublished ? [pagePath(input.key, t.slug, locale)] : [];
          }),
        );
      }

      await writeAuditLog(tx, {
        actorId: actor.id,
        ip: actor.ip,
        action: input.id ? 'content.page.update' : 'content.page.create',
        entityType: 'page',
        entityId: id,
        diff: {
          before: before && { ...before, translations: beforeTranslations },
          after: {
            key: input.key,
            status: input.status,
            translations: LOCALES.flatMap((locale) => {
              const t = input.translations[locale];
              return t ? [{ locale, slug: t.slug, isPublished: t.isPublished }] : [];
            }),
          },
        },
      });

      const tagList = [contentTags.pageList, contentTags.page(id), contentTags.menus];
      if (redirectCount > 0 || live) tagList.push(contentTags.redirects);
      return { id, tags: await revalidate(deps, tx, tagList) };
    },
    (constraint) =>
      constraint.includes('key')
        ? new ContentError('key_taken', 'key')
        : new ContentError('slug_taken', 'slug'),
  );
}

export async function deletePage(
  deps: ContentDeps,
  actor: Actor,
  rawId: unknown,
): Promise<CommandResult> {
  const id = idSchema.parse(rawId);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.delete(pages).where(eq(pages.id, id)).returning();
    if (!row) throw new ContentError('not_found');
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.page.delete',
      entityType: 'page',
      entityId: id,
      diff: { key: row.key },
    });
    return {
      id,
      tags: await revalidate(deps, tx, [
        contentTags.pageList,
        contentTags.page(id),
        contentTags.redirects,
      ]),
    };
  });
}

// ---------- Posts ----------

export async function savePost(
  deps: ContentDeps,
  actor: Actor,
  raw: unknown,
): Promise<CommandResult> {
  const input = postInputSchema.parse(raw);
  return transact(
    deps.db,
    async (tx) => {
      const id = input.id ?? newId();
      const live = input.status === 'active';
      let before: { status: string; publishedAt: Date | null } | null = null;
      let beforeTranslations: { locale: Locale; slug: string; isPublished: boolean }[] = [];
      const publishedAt = input.publishedAt ?? (live ? new Date() : null);

      if (input.id) {
        const [row] = await tx
          .select({ status: posts.status, publishedAt: posts.publishedAt })
          .from(posts)
          .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
          .for('update');
        if (!row) throw new ContentError('not_found');
        before = row;
        beforeTranslations = await tx
          .select({
            locale: postTranslations.locale,
            slug: postTranslations.slug,
            isPublished: postTranslations.isPublished,
          })
          .from(postTranslations)
          .where(eq(postTranslations.postId, id));
        await tx
          .update(posts)
          .set({ status: input.status, publishedAt, coverMediaId: input.coverMediaId })
          .where(eq(posts.id, id));
      } else {
        await tx.insert(posts).values({
          id,
          authorId: actor.id,
          status: input.status,
          publishedAt,
          coverMediaId: input.coverMediaId,
        });
      }

      for (const locale of LOCALES) {
        const t = input.translations[locale];
        if (!t) {
          await tx
            .delete(postTranslations)
            .where(and(eq(postTranslations.postId, id), eq(postTranslations.locale, locale)));
          continue;
        }
        await tx
          .insert(postTranslations)
          .values({ postId: id, locale, ...t })
          .onConflictDoUpdate({
            target: [postTranslations.postId, postTranslations.locale],
            set: { ...t, updatedAt: new Date() },
          });
      }

      await tx.delete(postTags).where(eq(postTags.postId, id));
      if (input.topicIds.length) {
        await tx
          .insert(postTags)
          .values([...new Set(input.topicIds)].map((tagId) => ({ postId: id, tagId })));
      }
      await tx.delete(postProducts).where(eq(postProducts.postId, id));
      if (input.productIds.length) {
        await tx.insert(postProducts).values(
          [...new Set(input.productIds)].map((productId, position) => ({
            postId: id,
            productId,
            position,
          })),
        );
      }

      const redirectCount = await redirectChangedPaths(
        tx,
        LOCALES.map((locale) => {
          const old = beforeTranslations.find((t) => t.locale === locale);
          const next = input.translations[locale];
          return {
            oldPath:
              before?.status === 'active' && old?.isPublished ? postPath(old.slug, locale) : null,
            newPath: next ? postPath(next.slug, locale) : null,
          };
        }),
      );
      if (live) {
        await releasePaths(
          tx,
          LOCALES.flatMap((locale) => {
            const t = input.translations[locale];
            return t?.isPublished ? [postPath(t.slug, locale)] : [];
          }),
        );
      }

      await writeAuditLog(tx, {
        actorId: actor.id,
        ip: actor.ip,
        action: input.id ? 'content.post.update' : 'content.post.create',
        entityType: 'post',
        entityId: id,
        diff: {
          before: before && { ...before, translations: beforeTranslations },
          after: {
            status: input.status,
            publishedAt,
            topicIds: input.topicIds,
            productIds: input.productIds,
            translations: LOCALES.flatMap((locale) => {
              const t = input.translations[locale];
              return t ? [{ locale, slug: t.slug, isPublished: t.isPublished }] : [];
            }),
          },
        },
      });

      const tagList = [contentTags.postList, contentTags.post(id)];
      if (redirectCount > 0 || live || before?.status === 'active')
        tagList.push(contentTags.redirects);
      return { id, tags: await revalidate(deps, tx, tagList) };
    },
    () => new ContentError('slug_taken', 'slug'),
  );
}

/** Soft delete (posts keep their row for history, §6.1). */
export async function deletePost(
  deps: ContentDeps,
  actor: Actor,
  rawId: unknown,
): Promise<CommandResult> {
  const id = idSchema.parse(rawId);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .returning({ id: posts.id });
    if (!row) throw new ContentError('not_found');
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.post.delete',
      entityType: 'post',
      entityId: id,
    });
    return {
      id,
      tags: await revalidate(deps, tx, [
        contentTags.postList,
        contentTags.post(id),
        contentTags.redirects,
      ]),
    };
  });
}

// ---------- Topics ----------

export async function saveTopic(
  deps: ContentDeps,
  actor: Actor,
  raw: unknown,
): Promise<CommandResult> {
  const input = topicInputSchema.parse(raw);
  return transact(
    deps.db,
    async (tx) => {
      const id = input.id ?? newId();
      let beforeTranslations: { locale: Locale; slug: string; isPublished: boolean }[] = [];
      if (input.id) {
        const [row] = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.id, id))
          .for('update');
        if (!row) throw new ContentError('not_found');
        beforeTranslations = await tx
          .select({
            locale: tagTranslations.locale,
            slug: tagTranslations.slug,
            isPublished: tagTranslations.isPublished,
          })
          .from(tagTranslations)
          .where(eq(tagTranslations.tagId, id));
        await tx.update(tags).set({ updatedAt: new Date() }).where(eq(tags.id, id));
      } else {
        await tx.insert(tags).values({ id });
      }
      for (const locale of LOCALES) {
        const t = input.translations[locale];
        if (!t) {
          await tx
            .delete(tagTranslations)
            .where(and(eq(tagTranslations.tagId, id), eq(tagTranslations.locale, locale)));
          continue;
        }
        await tx
          .insert(tagTranslations)
          .values({ tagId: id, locale, ...t })
          .onConflictDoUpdate({
            target: [tagTranslations.tagId, tagTranslations.locale],
            set: { ...t, updatedAt: new Date() },
          });
      }
      await redirectChangedPaths(
        tx,
        LOCALES.map((locale) => {
          const old = beforeTranslations.find((t) => t.locale === locale);
          const next = input.translations[locale];
          return {
            oldPath: old?.isPublished ? topicPath(old.slug, locale) : null,
            newPath: next ? topicPath(next.slug, locale) : null,
          };
        }),
      );
      await releasePaths(
        tx,
        LOCALES.flatMap((locale) => {
          const t = input.translations[locale];
          return t?.isPublished ? [topicPath(t.slug, locale)] : [];
        }),
      );
      await writeAuditLog(tx, {
        actorId: actor.id,
        ip: actor.ip,
        action: input.id ? 'content.topic.update' : 'content.topic.create',
        entityType: 'topic',
        entityId: id,
        diff: {
          before: beforeTranslations,
          after: LOCALES.flatMap((locale) => {
            const t = input.translations[locale];
            return t ? [{ locale, slug: t.slug, isPublished: t.isPublished }] : [];
          }),
        },
      });
      return {
        id,
        tags: await revalidate(deps, tx, [contentTags.postList, contentTags.redirects]),
      };
    },
    () => new ContentError('slug_taken', 'slug'),
  );
}

export async function deleteTopic(
  deps: ContentDeps,
  actor: Actor,
  rawId: unknown,
): Promise<CommandResult> {
  const id = idSchema.parse(rawId);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    if (!row) throw new ContentError('not_found');
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.topic.delete',
      entityType: 'topic',
      entityId: id,
    });
    return { id, tags: await revalidate(deps, tx, [contentTags.postList, contentTags.redirects]) };
  });
}

// ---------- Banners ----------

export async function saveBanner(
  deps: ContentDeps,
  actor: Actor,
  raw: unknown,
): Promise<CommandResult> {
  const input = bannerInputSchema.parse(raw);
  return deps.db.transaction(async (tx) => {
    const id = input.id ?? newId();
    const values = {
      placement: input.placement,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      position: input.position,
      isActive: input.isActive,
    };
    if (input.id) {
      const [row] = await tx.update(banners).set(values).where(eq(banners.id, id)).returning();
      if (!row) throw new ContentError('not_found');
    } else {
      await tx.insert(banners).values({ id, ...values });
    }
    for (const locale of LOCALES) {
      const t = input.translations[locale];
      if (!t) {
        await tx
          .delete(bannerTranslations)
          .where(and(eq(bannerTranslations.bannerId, id), eq(bannerTranslations.locale, locale)));
        continue;
      }
      await tx
        .insert(bannerTranslations)
        .values({ bannerId: id, locale, ...t })
        .onConflictDoUpdate({
          target: [bannerTranslations.bannerId, bannerTranslations.locale],
          set: { ...t, updatedAt: new Date() },
        });
    }
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: input.id ? 'content.banner.update' : 'content.banner.create',
      entityType: 'banner',
      entityId: id,
      diff: {
        ...values,
        translations: LOCALES.flatMap((locale) => {
          const t = input.translations[locale];
          return t ? [{ locale, title: t.title, isPublished: t.isPublished }] : [];
        }),
      },
    });
    return { id, tags: await revalidate(deps, tx, [contentTags.banners]) };
  });
}

export async function deleteBanner(
  deps: ContentDeps,
  actor: Actor,
  rawId: unknown,
): Promise<CommandResult> {
  const id = idSchema.parse(rawId);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id });
    if (!row) throw new ContentError('not_found');
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.banner.delete',
      entityType: 'banner',
      entityId: id,
    });
    return { id, tags: await revalidate(deps, tx, [contentTags.banners]) };
  });
}

// ---------- Menus ----------

export async function saveMenu(
  deps: ContentDeps,
  actor: Actor,
  raw: unknown,
): Promise<CommandResult> {
  const input = menuInputSchema.parse(raw);
  return deps.db.transaction(async (tx) => {
    let menuId = '';
    for (const locale of LOCALES) {
      const [row] = await tx
        .insert(navigationMenus)
        .values({ id: newId(), key: input.key, locale, items: input.items[locale] })
        .onConflictDoUpdate({
          target: [navigationMenus.key, navigationMenus.locale],
          set: { items: input.items[locale], updatedAt: new Date() },
        })
        .returning({ id: navigationMenus.id });
      if (locale === 'vi') menuId = row!.id;
    }
    await writeAuditLog(tx, {
      actorId: actor.id,
      ip: actor.ip,
      action: 'content.menu.update',
      entityType: 'navigation_menu',
      entityId: input.key,
      diff: { vi: input.items.vi.length, en: input.items.en.length },
    });
    return { id: menuId, tags: await revalidate(deps, tx, [contentTags.menus]) };
  });
}
