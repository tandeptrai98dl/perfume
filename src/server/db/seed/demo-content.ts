import { sql } from 'drizzle-orm';

import { docFromBlocks } from '@/lib/rich-text';
import { localizedPath } from '@/lib/seo/paths';
import { newId } from '@/server/lib/ids';

import type { Database } from '../client';
import { LEGAL_PAGES } from './legal-drafts';
import {
  bannerTranslations,
  banners,
  navigationMenus,
  pageTranslations,
  pages,
  postTags,
  postTranslations,
  posts,
  redirects,
  settings,
  tagTranslations,
  tags,
} from '../schema';

/**
 * Fictional bilingual demo content (original text written for this project). English is
 * published only where it was written; the cookie policy keeps an unpublished English draft
 * so the "English hidden until published" rule is visible (ADR-0021).
 */

type Blocks = Parameters<typeof docFromBlocks>[0];
type PageSeed = {
  key: string;
  vi: { title: string; slug: string; description: string; blocks: Blocks };
  en?: { title: string; slug: string; description: string; blocks: Blocks; published: boolean };
};

const PAGES: PageSeed[] = [
  {
    key: 'about',
    vi: {
      title: 'Về chúng tôi',
      slug: 'gioi-thieu',
      description: 'Câu chuyện của một cửa hàng nước hoa nhỏ, chọn từng chai bằng sự tỉ mỉ.',
      blocks: [
        {
          p: 'Perfume Store bắt đầu từ một kệ nước hoa nhỏ và niềm tin rằng mỗi mùi hương nên được chọn chậm rãi, như chọn một món đồ sẽ đi cùng mình nhiều năm.',
        },
        { h2: 'Điều chúng tôi theo đuổi' },
        {
          ul: [
            'Chỉ nhập hàng từ nhà phân phối có chứng từ rõ ràng.',
            'Tư vấn bằng trải nghiệm thật, không chạy theo xu hướng.',
            'Đóng gói cẩn thận, giao hàng trên toàn quốc.',
          ],
        },
      ],
    },
    en: {
      title: 'About us',
      slug: 'about',
      description: 'A small fragrance house that chooses every bottle with care.',
      published: true,
      blocks: [
        {
          p: 'Perfume Store began as a single shelf and a simple belief: a fragrance deserves to be chosen slowly, like something you will live with for years.',
        },
        { h2: 'What we stand for' },
        {
          ul: [
            'Stock sourced only from documented distributors.',
            'Advice based on wearing the scents ourselves, not on trends.',
            'Careful packing and nationwide delivery.',
          ],
        },
      ],
    },
  },
  {
    key: 'authenticity',
    vi: {
      title: 'Cam kết chính hãng',
      slug: 'cam-ket-chinh-hang',
      description: 'Mỗi chai nước hoa đều có nguồn gốc rõ ràng và được kiểm tra trước khi giao.',
      blocks: [
        {
          p: 'Chúng tôi chỉ bán nước hoa chính hãng. Mỗi lô hàng đều đi kèm hoá đơn và chứng từ nhập khẩu.',
        },
        { h2: 'Cách chúng tôi kiểm tra' },
        { p: 'Mã lô, bao bì và vòi xịt được đối chiếu trước khi sản phẩm lên kệ.' },
        { h2: 'Nếu bạn còn băn khoăn' },
        { p: 'Hãy liên hệ để được xem chứng từ của sản phẩm bạn đã mua.' },
      ],
    },
    en: {
      title: 'Authenticity guarantee',
      slug: 'authenticity',
      description: 'Every bottle has a documented origin and is checked before it ships.',
      published: true,
      blocks: [
        {
          p: 'We sell authentic fragrances only. Every shipment comes with invoices and import documents.',
        },
        { h2: 'How we check' },
        { p: 'Batch codes, packaging and atomisers are inspected before a product goes on sale.' },
        { h2: 'Still unsure?' },
        { p: 'Contact us and we will show you the documents for the product you bought.' },
      ],
    },
  },
  {
    key: 'contact',
    vi: {
      title: 'Liên hệ',
      slug: 'lien-he',
      description: 'Liên hệ Perfume Store để được tư vấn mùi hương và hỗ trợ đơn hàng.',
      blocks: [
        { p: 'Chúng tôi trả lời tin nhắn từ 9:00 đến 21:00 mỗi ngày, kể cả cuối tuần.' },
        { p: 'Để được hỗ trợ đơn hàng nhanh hơn, vui lòng gửi kèm mã đơn hàng.' },
      ],
    },
    en: {
      title: 'Contact',
      slug: 'contact',
      description: 'Get in touch for fragrance advice and help with your order.',
      published: true,
      blocks: [
        { p: 'We reply to messages from 9 am to 9 pm every day, weekends included.' },
        { p: 'For faster help with an order, please include your order code.' },
      ],
    },
  },
  {
    key: 'faq',
    vi: {
      title: 'Câu hỏi thường gặp',
      slug: 'cau-hoi-thuong-gap',
      description: 'Giải đáp nhanh về hàng chính hãng, giao hàng, thanh toán và đổi trả.',
      blocks: [
        { h2: 'Sản phẩm có phải hàng chính hãng không?' },
        { p: 'Có. Mọi sản phẩm đều có chứng từ nhập khẩu và được kiểm tra trước khi giao.' },
        { h2: 'Bao lâu thì tôi nhận được hàng?' },
        { p: 'Thông thường từ 1 đến 2 ngày tại nội thành và 3 đến 5 ngày tại các tỉnh khác.' },
        { h2: 'Tôi có thể đổi trả không?' },
        {
          p: 'Bạn có thể yêu cầu đổi trả trong 7 ngày kể từ khi nhận hàng nếu sản phẩm còn nguyên seal.',
        },
      ],
    },
    en: {
      title: 'Frequently asked questions',
      slug: 'faq',
      description: 'Quick answers about authenticity, delivery, payment and returns.',
      published: true,
      blocks: [
        { h2: 'Are your products authentic?' },
        { p: 'Yes. Every product has import documents and is inspected before it ships.' },
        { h2: 'How long does delivery take?' },
        { p: 'Usually 1–2 days within major cities and 3–5 days elsewhere in Vietnam.' },
        { h2: 'Can I return an order?' },
        { p: 'You can request a return within 7 days of delivery if the product is still sealed.' },
      ],
    },
  },
  // Legal pages: draft texts pending lawyer review (M3 privacy stream).
  ...LEGAL_PAGES,
];

const TOPICS = [
  {
    key: 'choosing',
    vi: ['Chọn mùi hương', 'chon-mui-huong'],
    en: ['Choosing a scent', 'choosing-a-scent'],
  },
  { key: 'gifting', vi: ['Quà tặng', 'qua-tang'], en: ['Gifting', 'gifting'] },
] as const;

export const DEMO_POST_SLUGS = { vi: 'edt-hay-edp', en: 'edt-or-edp' } as const;
export const DEMO_REDIRECT = { fromPath: '/tap-chi/cach-chon-nong-do-nuoc-hoa' } as const;

const POSTS = [
  {
    topics: ['choosing'],
    daysAgo: 3,
    vi: {
      title: 'EDT hay EDP: chọn nồng độ nào cho bạn?',
      slug: DEMO_POST_SLUGS.vi,
      excerpt: 'Nồng độ ảnh hưởng đến độ lưu hương, độ toả và cả cảm giác của mùi hương trên da.',
      blocks: [
        {
          p: 'Cùng một mùi hương có thể có nhiều nồng độ. Sự khác biệt không chỉ nằm ở độ bền mà còn ở cách mùi hương mở ra trên da.',
        },
        { h2: 'Eau de Toilette' },
        { p: 'Nhẹ và tươi hơn, phù hợp ngày nóng và môi trường văn phòng.' },
        { h2: 'Eau de Parfum' },
        { p: 'Đậm và tròn hơn, lưu hương lâu hơn, hợp với buổi tối hoặc mùa lạnh.' },
      ],
    },
    en: {
      title: 'EDT or EDP: which concentration suits you?',
      slug: DEMO_POST_SLUGS.en,
      excerpt:
        'Concentration changes how long a scent lasts, how far it projects and how it feels on skin.',
      blocks: [
        {
          p: 'The same scent often comes in several concentrations. The difference is not only longevity but also how the fragrance unfolds on skin.',
        },
        { h2: 'Eau de Toilette' },
        { p: 'Lighter and brighter: a good fit for hot days and the office.' },
        { h2: 'Eau de Parfum' },
        { p: 'Richer and rounder with longer wear: made for evenings and cooler weather.' },
      ],
    },
  },
  {
    topics: ['gifting'],
    daysAgo: 10,
    vi: {
      title: 'Gợi ý tặng nước hoa cho người mới bắt đầu',
      slug: 'tang-nuoc-hoa-cho-nguoi-moi',
      excerpt: 'Vài nguyên tắc đơn giản giúp món quà mùi hương dễ được yêu thích hơn.',
      blocks: [
        {
          p: 'Khi chưa biết gu của người nhận, hãy bắt đầu từ những nhóm hương dễ chịu như cam chanh hoặc hương hoa nhẹ.',
        },
        {
          p: 'Một chai dung tích nhỏ cũng là lựa chọn tinh tế để người nhận thử trước khi chọn chai lớn.',
        },
      ],
    },
    en: null,
  },
];

export async function seedDemoContent(db: Database) {
  const [{ count }] = (
    await db.execute<{ count: number }>(sql`select count(*)::int as count from pages`)
  ).rows as [{ count: number }];
  if (count > 0) return { skipped: true, pages: 0, posts: 0 };

  for (const page of PAGES) {
    const pageId = newId();
    await db.insert(pages).values({ id: pageId, key: page.key, status: 'active' });
    await db.insert(pageTranslations).values({
      pageId,
      locale: 'vi',
      title: page.vi.title,
      slug: page.vi.slug,
      seoDescription: page.vi.description,
      content: docFromBlocks(page.vi.blocks),
      isPublished: true,
    });
    if (page.en) {
      await db.insert(pageTranslations).values({
        pageId,
        locale: 'en',
        title: page.en.title,
        slug: page.en.slug,
        seoDescription: page.en.description,
        content: docFromBlocks(page.en.blocks),
        isPublished: page.en.published,
      });
    }
  }

  const topicIds = new Map<string, string>();
  for (const topic of TOPICS) {
    const tagId = newId();
    topicIds.set(topic.key, tagId);
    await db.insert(tags).values({ id: tagId });
    await db.insert(tagTranslations).values([
      { tagId, locale: 'vi', name: topic.vi[0], slug: topic.vi[1], isPublished: true },
      { tagId, locale: 'en', name: topic.en[0], slug: topic.en[1], isPublished: true },
    ]);
  }

  for (const post of POSTS) {
    const postId = newId();
    await db.insert(posts).values({
      id: postId,
      status: 'active',
      publishedAt: new Date(Date.now() - post.daysAgo * 24 * 60 * 60 * 1000),
    });
    await db.insert(postTranslations).values({
      postId,
      locale: 'vi',
      title: post.vi.title,
      slug: post.vi.slug,
      excerpt: post.vi.excerpt,
      content: docFromBlocks(post.vi.blocks),
      isPublished: true,
    });
    if (post.en) {
      await db.insert(postTranslations).values({
        postId,
        locale: 'en',
        title: post.en.title,
        slug: post.en.slug,
        excerpt: post.en.excerpt,
        content: docFromBlocks(post.en.blocks),
        isPublished: true,
      });
    }
    await db
      .insert(postTags)
      .values(post.topics.map((key) => ({ postId, tagId: topicIds.get(key)! })));
  }

  const link = (id: string, label: string, href: string) => ({ id, label, href });
  const menus = {
    header: {
      vi: [
        link('perfumes', 'Nước hoa', localizedPath('vi', '/perfumes')),
        link('brands', 'Thương hiệu', localizedPath('vi', '/brands')),
        link('journal', 'Tạp chí', localizedPath('vi', '/journal')),
      ],
      en: [
        link('perfumes', 'Perfumes', localizedPath('en', '/perfumes')),
        link('brands', 'Brands', localizedPath('en', '/brands')),
        link('journal', 'Journal', localizedPath('en', '/journal')),
      ],
    },
    footer: {
      vi: [
        link('about', 'Về chúng tôi', localizedPath('vi', '/about')),
        link('authenticity', 'Cam kết chính hãng', localizedPath('vi', '/authenticity')),
        link('journal', 'Tạp chí', localizedPath('vi', '/journal')),
        link('faq', 'Câu hỏi thường gặp', localizedPath('vi', '/faq')),
        link('contact', 'Liên hệ', localizedPath('vi', '/contact')),
      ],
      en: [
        link('about', 'About us', localizedPath('en', '/about')),
        link('authenticity', 'Authenticity', localizedPath('en', '/authenticity')),
        link('journal', 'Journal', localizedPath('en', '/journal')),
        link('faq', 'FAQ', localizedPath('en', '/faq')),
        link('contact', 'Contact', localizedPath('en', '/contact')),
      ],
    },
    legal: {
      vi: PAGES.filter((p) => !['about', 'authenticity', 'contact', 'faq'].includes(p.key)).map(
        (p) =>
          link(p.key, p.vi.title, localizedPath('vi', '/policies/[slug]', { slug: p.vi.slug })),
      ),
      en: PAGES.filter(
        (p) => !['about', 'authenticity', 'contact', 'faq'].includes(p.key) && p.en?.published,
      ).map((p) =>
        link(p.key, p.en!.title, localizedPath('en', '/policies/[slug]', { slug: p.en!.slug })),
      ),
    },
  };
  for (const [key, items] of Object.entries(menus)) {
    await db.insert(navigationMenus).values([
      { key, locale: 'vi', items: items.vi },
      { key, locale: 'en', items: items.en },
    ]);
  }

  const heroId = newId();
  await db.insert(banners).values({ id: heroId, placement: 'home_hero', isActive: true });
  await db.insert(bannerTranslations).values([
    {
      bannerId: heroId,
      locale: 'vi',
      title: 'Mùi hương cho mùa mới',
      subtitle: 'Tuyển chọn những chai nước hoa nhẹ nhàng, dễ dùng mỗi ngày.',
      ctaLabel: 'Khám phá',
      ctaUrl: localizedPath('vi', '/perfumes'),
      isPublished: true,
    },
    {
      bannerId: heroId,
      locale: 'en',
      title: 'Scents for a new season',
      subtitle: 'A selection of easy, everyday fragrances.',
      ctaLabel: 'Discover',
      ctaUrl: localizedPath('en', '/perfumes'),
      isPublished: true,
    },
  ]);
  const announcementId = newId();
  await db
    .insert(banners)
    .values({ id: announcementId, placement: 'announcement', isActive: true });
  await db.insert(bannerTranslations).values([
    {
      bannerId: announcementId,
      locale: 'vi',
      title: 'Cam kết chính hãng · Đổi trả trong 7 ngày',
      ctaLabel: 'Tìm hiểu',
      ctaUrl: localizedPath('vi', '/authenticity'),
      isPublished: true,
    },
    {
      bannerId: announcementId,
      locale: 'en',
      title: 'Authenticity guaranteed · 7-day returns',
      ctaLabel: 'Learn more',
      ctaUrl: localizedPath('en', '/authenticity'),
      isPublished: true,
    },
  ]);

  // An old journal URL kept alive after a slug change (E2E checks the 301).
  await db.insert(redirects).values({
    fromPath: DEMO_REDIRECT.fromPath,
    toPath: localizedPath('vi', '/journal/[slug]', { slug: DEMO_POST_SLUGS.vi }),
    statusCode: 301,
  });

  // Placeholder seller information for the footer (§1.5); the owner edits it in settings.
  await db
    .insert(settings)
    .values(
      Object.entries({
        'company.name': 'Công ty TNHH Perfume Store (dữ liệu mẫu)',
        'company.taxCode': '0000000000',
        'company.address': 'Địa chỉ mẫu, TP. Hồ Chí Minh',
        'company.legalRepresentative': 'Người đại diện mẫu',
        'company.phone': '1900 0000',
        'company.email': 'hello@example.com',
        'company.businessRegistration': 'Giấy chứng nhận ĐKDN số 0000000000 (mẫu)',
      }).map(([key, value]) => ({ key, value })),
    )
    .onConflictDoNothing();

  return { skipped: false, pages: PAGES.length, posts: POSTS.length };
}
