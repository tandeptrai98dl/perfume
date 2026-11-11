import type { RichTextDoc } from '@/lib/rich-text';

/** Form value shapes and converters shared by admin content pages (server) and forms (client). */

export type Locale = 'vi' | 'en';

export type TranslationValues = {
  title: string;
  slug: string;
  excerpt: string;
  content: RichTextDoc | null;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
};

export const emptyTranslation = (): TranslationValues => ({
  title: '',
  slug: '',
  excerpt: '',
  content: null,
  seoTitle: '',
  seoDescription: '',
  isPublished: false,
});

export type TranslatableForm = {
  hasEn: boolean;
  translations: Record<Locale, TranslationValues>;
};

export const BANNER_PLACEMENTS = [
  'home_hero',
  'home_promo',
  'category_top',
  'announcement',
] as const;

export type BannerTranslationValues = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaUrl: string;
  desktopMediaId: string;
  mobileMediaId: string;
  isPublished: boolean;
};

export type BannerFormValues = {
  placement: (typeof BANNER_PLACEMENTS)[number];
  position: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  hasEn: boolean;
  translations: Record<Locale, BannerTranslationValues>;
};

export const emptyBannerTranslation = (): BannerTranslationValues => ({
  title: '',
  subtitle: '',
  ctaLabel: '',
  ctaUrl: '',
  desktopMediaId: '',
  mobileMediaId: '',
  isPublished: false,
});

type Item = { id: string; label: string; href: string };
export type MenuRow = {
  id: string;
  labelVi: string;
  hrefVi: string;
  labelEn: string;
  hrefEn: string;
};

/** Merges the per-locale stored lists into rows (order of the Vietnamese menu first). */
export function menuRows(items: { vi: Item[]; en: Item[] }): MenuRow[] {
  const rows = items.vi.map((item) => ({
    id: item.id,
    labelVi: item.label,
    hrefVi: item.href,
    labelEn: '',
    hrefEn: '',
  }));
  for (const item of items.en) {
    const row = rows.find((r) => r.id === item.id);
    if (row) Object.assign(row, { labelEn: item.label, hrefEn: item.href });
    else
      rows.push({ id: item.id, labelVi: '', hrefVi: '', labelEn: item.label, hrefEn: item.href });
  }
  return rows;
}

/** Stored translation → form values. */
export function translationValues(
  stored:
    | {
        title?: string;
        name?: string;
        slug?: string;
        excerpt?: string | null;
        content?: unknown;
        seoTitle?: string | null;
        seoDescription?: string | null;
        isPublished: boolean;
      }
    | undefined,
): TranslationValues {
  if (!stored) return emptyTranslation();
  return {
    title: stored.title ?? stored.name ?? '',
    slug: stored.slug ?? '',
    excerpt: stored.excerpt ?? '',
    content: (stored.content as RichTextDoc | null) ?? null,
    seoTitle: stored.seoTitle ?? '',
    seoDescription: stored.seoDescription ?? '',
    isPublished: stored.isPublished,
  };
}

/*
 * Admin date-times are entered in Vietnam time (Asia/Ho_Chi_Minh, UTC+7, no DST), on the server
 * and in the browser alike, so `<input type="datetime-local">` values never depend on the
 * machine's time zone (and server and client render the same value).
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `Date` → `YYYY-MM-DDTHH:mm` in Vietnam time (empty string for null). */
export function toAdminInput(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
}

/** `YYYY-MM-DDTHH:mm` in Vietnam time → ISO string (null when empty or invalid). */
export function fromAdminInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
