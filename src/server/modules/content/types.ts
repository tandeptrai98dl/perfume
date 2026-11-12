import type { RichTextDoc } from '@/lib/rich-text';

/** Content module types (public API, see index.ts). */

export type Locale = 'vi' | 'en';
export const LOCALES: readonly Locale[] = ['vi', 'en'];

export type PublicationStatus = 'draft' | 'active' | 'archived';

/** Pages served at fixed routes (`/about`, …); every other key is a policy (`/policies/[slug]`). */
export const INFO_PAGE_KEYS = ['about', 'authenticity', 'contact', 'faq'] as const;
export type InfoPageKey = (typeof INFO_PAGE_KEYS)[number];

export function isInfoPageKey(key: string): key is InfoPageKey {
  return (INFO_PAGE_KEYS as readonly string[]).includes(key);
}

export const BANNER_PLACEMENTS = [
  'home_hero',
  'home_promo',
  'category_top',
  'announcement',
] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

/** Menus rendered by the storefront: header navigation, footer links, footer legal links. */
export const MENU_KEYS = ['header', 'footer', 'legal'] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];

/** Public paths of one entity per locale (only published locales are present). */
export type Alternates = Partial<Record<Locale, string>>;

export type MediaRef = { id: string; url: string; width: number | null; height: number | null };

export type PageView = {
  id: string;
  key: string;
  locale: Locale;
  title: string;
  slug: string;
  content: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  path: string;
  alternates: Alternates;
  updatedAt: Date;
};

export type TopicView = {
  id: string;
  locale: Locale;
  name: string;
  slug: string;
  description: string | null;
  path: string;
  alternates: Alternates;
};

export type PostSummary = {
  id: string;
  locale: Locale;
  title: string;
  slug: string;
  excerpt: string | null;
  cover: MediaRef | null;
  publishedAt: Date;
  updatedAt: Date;
  path: string;
};

export type PostView = PostSummary & {
  content: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  authorName: string | null;
  topics: { name: string; slug: string; path: string }[];
  productIds: string[];
  alternates: Alternates;
};

export type BannerView = {
  id: string;
  placement: BannerPlacement;
  position: number;
  startsAt: Date | null;
  endsAt: Date | null;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  desktopMedia: MediaRef | null;
  mobileMedia: MediaRef | null;
};

export type MenuItem = { id: string; label: string; href: string };

export type SellerInfo = {
  companyName: string | null;
  taxCode: string | null;
  address: string | null;
  legalRepresentative: string | null;
  phone: string | null;
  email: string | null;
  businessRegistration: string | null;
  /** M3: record of the website notification on online.gov.vn (badge hidden until set). */
  moitNotificationUrl: string | null;
  /** M3: official "Đã thông báo Bộ Công Thương" badge image (optional; text badge otherwise). */
  moitBadgeImageUrl: string | null;
};

export type RedirectRule = {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: RedirectStatusCode;
};

export type SitemapContentEntry = {
  /** Public path per published locale. */
  alternates: Alternates;
  lastModified: Date;
};

/** Who performed a write (audit log). */
export type Actor = { id: string | null; ip?: string | null };
