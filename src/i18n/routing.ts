import { defineRouting } from 'next-intl/routing';

/**
 * Locales and localized pathnames (ADR-0011).
 * - Vietnamese is the default and has no prefix; English lives under /en.
 * - Route folders are English; Vietnamese URLs are mapped here.
 * - No automatic redirect based on Accept-Language (localeDetection: false).
 */
export const routing = defineRouting({
  locales: ['vi', 'en'],
  defaultLocale: 'vi',
  localePrefix: 'as-needed',
  localeDetection: false,
  pathnames: {
    '/': '/',
    '/perfumes': { vi: '/nuoc-hoa', en: '/perfumes' },
    '/categories/[slug]': { vi: '/danh-muc/[slug]', en: '/categories/[slug]' },
    '/brands': { vi: '/thuong-hieu', en: '/brands' },
    '/brands/[slug]': { vi: '/thuong-hieu/[slug]', en: '/brands/[slug]' },
    '/collections/[slug]': { vi: '/bo-suu-tap/[slug]', en: '/collections/[slug]' },
    '/scent-families/[slug]': { vi: '/nhom-huong/[slug]', en: '/scent-families/[slug]' },
    '/products/[slug]': { vi: '/san-pham/[slug]', en: '/products/[slug]' },
    '/search': { vi: '/tim-kiem', en: '/search' },
    '/cart': { vi: '/gio-hang', en: '/cart' },
    '/checkout': { vi: '/thanh-toan', en: '/checkout' },
    '/checkout/result': { vi: '/thanh-toan/ket-qua', en: '/checkout/result' },
    '/order-lookup': { vi: '/tra-cuu-don-hang', en: '/order-lookup' },
    '/review/[token]': { vi: '/danh-gia/[token]', en: '/review/[token]' },
    '/sign-in': { vi: '/dang-nhap', en: '/sign-in' },
    '/sign-up': { vi: '/dang-ky', en: '/sign-up' },
    '/forgot-password': { vi: '/quen-mat-khau', en: '/forgot-password' },
    '/reset-password': { vi: '/dat-lai-mat-khau', en: '/reset-password' },
    '/account': { vi: '/tai-khoan', en: '/account' },
    '/account/orders': { vi: '/tai-khoan/don-hang', en: '/account/orders' },
    '/account/orders/[code]': { vi: '/tai-khoan/don-hang/[code]', en: '/account/orders/[code]' },
    '/account/addresses': { vi: '/tai-khoan/dia-chi', en: '/account/addresses' },
    '/account/wishlist': { vi: '/tai-khoan/yeu-thich', en: '/account/wishlist' },
    '/account/profile': { vi: '/tai-khoan/ho-so', en: '/account/profile' },
    '/account/privacy': { vi: '/tai-khoan/quyen-rieng-tu', en: '/account/privacy' },
    // M3 reviews stream: purchases to review + own reviews (ADR-0008).
    '/account/reviews': { vi: '/tai-khoan/danh-gia', en: '/account/reviews' },
    '/journal': { vi: '/tap-chi', en: '/journal' },
    '/journal/[slug]': { vi: '/tap-chi/[slug]', en: '/journal/[slug]' },
    '/journal/topics/[slug]': { vi: '/tap-chi/chu-de/[slug]', en: '/journal/topics/[slug]' },
    '/about': { vi: '/gioi-thieu', en: '/about' },
    '/authenticity': { vi: '/cam-ket-chinh-hang', en: '/authenticity' },
    '/contact': { vi: '/lien-he', en: '/contact' },
    '/faq': { vi: '/cau-hoi-thuong-gap', en: '/faq' },
    '/policies/[slug]': { vi: '/chinh-sach/[slug]', en: '/policies/[slug]' },
    // M3 privacy: data-subject requests without an account (verified by e-mail).
    '/privacy-request': { vi: '/quyen-rieng-tu/yeu-cau', en: '/privacy-request' },
    '/privacy-request/confirm': {
      vi: '/quyen-rieng-tu/yeu-cau/xac-nhan',
      en: '/privacy-request/confirm',
    },
  },
});

export type Locale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
