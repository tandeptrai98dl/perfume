import { z } from 'zod';

import type { RichTextNode } from '@/lib/rich-text';

import { normalizePath } from './redirects';
import { BANNER_PLACEMENTS, MENU_KEYS, REDIRECT_STATUS_CODES } from './types';

/*
 * Input schemas for content writes. Error messages are stable codes; the admin UI maps them to
 * `admin.content.errors.<code>`.
 */

const MAX_DOC_BYTES = 200_000;

const richTextMark = z.object({
  type: z.string().min(1).max(64),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const richTextNode: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richTextNode).max(2000).optional(),
    marks: z.array(richTextMark).max(10).optional(),
    text: z.string().max(20_000).optional(),
  }),
);

/** Tiptap JSON document. Rendering applies the allowlist; this only bounds shape and size. */
export const richTextDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(richTextNode).max(2000).optional() })
  .refine((doc) => JSON.stringify(doc).length <= MAX_DOC_BYTES, { error: 'content_too_large' });

/** Lowercase ASCII words separated by single hyphens. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: 'required' })
  .max(120, { error: 'too_long' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'slug_invalid' });

const requiredText = (max: number) =>
  z.string().trim().min(1, { error: 'required' }).max(max, { error: 'too_long' });

/** Optional text: empty strings become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'too_long' })
    .nullish()
    .transform((value) => (value ? value : null));

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => (value ? value : null));

const optionalDate = z
  .union([z.coerce.date(), z.literal('')])
  .nullish()
  .transform((value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value : null));

/** A site-relative path (`/nuoc-hoa`) or an absolute http(s) URL. */
export const linkTargetSchema = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(2048, { error: 'too_long' })
  .transform((value, ctx) => {
    if (/^https?:\/\//i.test(value)) {
      try {
        return new URL(value).href;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'url_invalid' });
        return z.NEVER;
      }
    }
    const path = normalizePath(value);
    if (!path) {
      ctx.addIssue({ code: 'custom', message: 'url_invalid' });
      return z.NEVER;
    }
    return path;
  });

export const publicPathSchema = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(2048, { error: 'too_long' })
  .transform((value, ctx) => {
    const path = normalizePath(value);
    if (!path) {
      ctx.addIssue({ code: 'custom', message: 'path_invalid' });
      return z.NEVER;
    }
    return path;
  });

const statusSchema = z.enum(['draft', 'active', 'archived']);

/** Vietnamese is required to publish anything, and English needs Vietnamese (ADR-0021). */
function requireVietnameseToPublish(
  value: {
    translations: { vi: { isPublished: boolean }; en?: { isPublished: boolean } | null };
    status?: string;
    isActive?: boolean;
  },
  ctx: z.RefinementCtx,
) {
  const live = value.status === 'active' || value.isActive === true;
  const enPublished = value.translations.en?.isPublished === true;
  if ((live || enPublished) && !value.translations.vi.isPublished) {
    ctx.addIssue({
      code: 'custom',
      message: 'vi_required',
      path: ['translations', 'vi', 'isPublished'],
    });
  }
}

// ---------- Pages ----------

const pageTranslationSchema = z.object({
  title: requiredText(200),
  slug: slugSchema,
  content: richTextDocSchema.nullish().transform((v) => v ?? null),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
  isPublished: z.boolean(),
});

export const pageInputSchema = z
  .object({
    id: z.uuid().optional(),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]{1,40}$/, { error: 'key_invalid' }),
    status: statusSchema,
    translations: z.object({
      vi: pageTranslationSchema,
      en: pageTranslationSchema.nullish().transform((v) => v ?? null),
    }),
  })
  .superRefine(requireVietnameseToPublish);
export type PageInput = z.input<typeof pageInputSchema>;

// ---------- Posts ----------

const postTranslationSchema = z.object({
  title: requiredText(200),
  slug: slugSchema,
  excerpt: optionalText(300),
  content: richTextDocSchema.nullish().transform((v) => v ?? null),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
  isPublished: z.boolean(),
});

export const postInputSchema = z
  .object({
    id: z.uuid().optional(),
    status: statusSchema,
    publishedAt: optionalDate,
    coverMediaId: optionalId,
    topicIds: z.array(z.uuid()).max(20).default([]),
    productIds: z.array(z.uuid()).max(24).default([]),
    translations: z.object({
      vi: postTranslationSchema,
      en: postTranslationSchema.nullish().transform((v) => v ?? null),
    }),
  })
  .superRefine(requireVietnameseToPublish);
export type PostInput = z.input<typeof postInputSchema>;

// ---------- Topics ----------

const topicTranslationSchema = z.object({
  name: requiredText(80),
  slug: slugSchema,
  description: optionalText(300),
  isPublished: z.boolean(),
});

export const topicInputSchema = z
  .object({
    id: z.uuid().optional(),
    translations: z.object({
      vi: topicTranslationSchema,
      en: topicTranslationSchema.nullish().transform((v) => v ?? null),
    }),
  })
  .superRefine(requireVietnameseToPublish);
export type TopicInput = z.input<typeof topicInputSchema>;

// ---------- Banners ----------

const bannerTranslationSchema = z.object({
  title: requiredText(120),
  subtitle: optionalText(240),
  ctaLabel: optionalText(40),
  ctaUrl: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    linkTargetSchema.nullable(),
  ),
  desktopMediaId: optionalId,
  mobileMediaId: optionalId,
  isPublished: z.boolean(),
});

export const bannerInputSchema = z
  .object({
    id: z.uuid().optional(),
    placement: z.enum(BANNER_PLACEMENTS),
    startsAt: optionalDate,
    endsAt: optionalDate,
    position: z.coerce.number().int().min(0).max(999).default(0),
    isActive: z.boolean(),
    translations: z.object({
      vi: bannerTranslationSchema,
      en: bannerTranslationSchema.nullish().transform((v) => v ?? null),
    }),
  })
  .superRefine((value, ctx) => {
    requireVietnameseToPublish(value, ctx);
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: 'custom', message: 'schedule_invalid', path: ['endsAt'] });
    }
    for (const locale of ['vi', 'en'] as const) {
      const t = value.translations[locale];
      if (t && Boolean(t.ctaLabel) !== Boolean(t.ctaUrl)) {
        ctx.addIssue({
          code: 'custom',
          message: 'cta_incomplete',
          path: ['translations', locale, t.ctaLabel ? 'ctaUrl' : 'ctaLabel'],
        });
      }
    }
  });
export type BannerInput = z.input<typeof bannerInputSchema>;

// ---------- Menus ----------

export const menuItemSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: requiredText(80),
  href: linkTargetSchema,
});

export const menuInputSchema = z.object({
  key: z.enum(MENU_KEYS),
  items: z.object({
    vi: z.array(menuItemSchema).max(30),
    en: z.array(menuItemSchema).max(30),
  }),
});
export type MenuInput = z.input<typeof menuInputSchema>;

export const menuItemsSchema = z.array(menuItemSchema);

// ---------- Redirects ----------

export const redirectInputSchema = z
  .object({
    fromPath: publicPathSchema,
    toPath: linkTargetSchema,
    statusCode: z.coerce
      .number()
      .int()
      .refine((code) => (REDIRECT_STATUS_CODES as readonly number[]).includes(code), {
        error: 'status_invalid',
      })
      .default(301),
  })
  .refine((value) => value.fromPath !== value.toPath, {
    error: 'redirect_self',
    path: ['toPath'],
  })
  .refine((value) => !value.fromPath.startsWith('/admin') && !value.fromPath.startsWith('/api'), {
    error: 'path_reserved',
    path: ['fromPath'],
  });
export type RedirectInput = z.input<typeof redirectInputSchema>;

export const idSchema = z.uuid();
