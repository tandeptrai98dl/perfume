import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { ContentArticle, ContentArticleSkeleton } from '@/components/content/content-article';
import { getPolicyPage } from '@/data/content';
import { richTextToPlainText } from '@/lib/rich-text';
import { RichText } from '@/lib/rich-text/react';
import { contentMetadata } from '@/lib/seo/content-metadata';
import { localizedPath } from '@/lib/seo/paths';

import { resolveLocale, siteOrigin } from '../../_content/shared';

type Props = PageProps<'/[locale]/policies/[slug]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  await connection();
  const page = await getPolicyPage(slug, locale);
  if (!page) return {};
  return contentMetadata({
    origin: siteOrigin(),
    locale,
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? richTextToPlainText(page.content),
    path: page.path,
    alternates: page.alternates,
  });
}

/** Returns, shipping, payment, privacy, terms, cookies… (§5.1). */
export default function PolicyPage({ params }: Props) {
  return (
    <Suspense fallback={<ContentArticleSkeleton />}>
      <PolicyBody params={params} />
    </Suspense>
  );
}

async function PolicyBody({ params }: { params: Props['params'] }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  await connection();
  const page = await getPolicyPage(slug, locale);
  if (!page) notFound();

  const [t, format] = await Promise.all([getTranslations({ locale }), getFormatter({ locale })]);
  const origin = siteOrigin();
  return (
    <ContentArticle
      title={page.title}
      eyebrow={t('content.policies')}
      breadcrumbs={[
        { name: t('navigation.home'), href: localizedPath(locale, '/') },
        { name: page.title },
      ]}
      baseUrl={origin}
      meta={t('content.updatedOn', {
        date: format.dateTime(new Date(page.updatedAt), { dateStyle: 'long' }),
      })}
    >
      <RichText value={page.content} siteOrigin={origin} />
      {/* §3.6: policies exist in English, the Vietnamese version prevails. */}
      {locale !== 'vi' && (
        <p className="text-small border-line-200 mt-12 max-w-prose border-t pt-6 text-taupe-600">
          {t('content.legalPrevails')}
        </p>
      )}
    </ContentArticle>
  );
}
