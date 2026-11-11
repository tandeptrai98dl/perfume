import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { ContentArticle, ContentArticleSkeleton } from '@/components/content/content-article';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { getInfoPage, getSellerInfo } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { extractFaq, richTextToPlainText, splitByHeadings } from '@/lib/rich-text';
import { RichText } from '@/lib/rich-text/react';
import { faqPageJsonLd, serializeJsonLd } from '@/lib/seo/content-json-ld';
import { contentMetadata } from '@/lib/seo/content-metadata';
import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { InfoPageKey, PageView } from '@/server/modules/content';

import { resolveLocale, siteOrigin } from './shared';

type Params = Promise<{ locale: string }>;

/** Metadata for an information page; deferred to request time like the page itself. */
export async function infoPageMetadata(pageKey: InfoPageKey, params: Params): Promise<Metadata> {
  const locale = await resolveLocale(params);
  await connection();
  const page = await getInfoPage(pageKey, locale);
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

/** About, authenticity, contact and FAQ pages (§5.1), rendered from `pages` by key. */
export function InfoPage({ pageKey, params }: { pageKey: InfoPageKey; params: Params }) {
  return (
    <Suspense fallback={<ContentArticleSkeleton />}>
      <InfoPageBody pageKey={pageKey} params={params} />
    </Suspense>
  );
}

async function InfoPageBody({ pageKey, params }: { pageKey: InfoPageKey; params: Params }) {
  const locale = await resolveLocale(params);
  await connection();
  const page = await getInfoPage(pageKey, locale);
  if (!page) notFound();

  const [t, format] = await Promise.all([getTranslations({ locale }), getFormatter({ locale })]);
  const origin = siteOrigin();

  return (
    <ContentArticle
      title={page.title}
      breadcrumbs={[
        { name: t('navigation.home'), href: localizedPath(locale, '/') },
        { name: page.title },
      ]}
      baseUrl={origin}
      meta={t('content.updatedOn', {
        date: format.dateTime(new Date(page.updatedAt), { dateStyle: 'long' }),
      })}
    >
      {pageKey === 'faq' ? (
        <FaqBody page={page} locale={locale} origin={origin} />
      ) : (
        <RichText value={page.content} siteOrigin={origin} />
      )}
      {pageKey === 'contact' && <SellerDetails locale={locale} />}
    </ContentArticle>
  );
}

function FaqBody({ page, locale, origin }: { page: PageView; locale: Locale; origin: string }) {
  const { intro, sections } = splitByHeadings(page.content);
  const entries = extractFaq(page.content);
  return (
    <>
      <RichText value={intro} siteOrigin={origin} />
      <Accordion type="multiple" className="max-w-3xl">
        {sections.map((section, index) => (
          <AccordionItem key={`${index}-${section.heading}`} value={String(index)}>
            {/* The trigger sits in the accordion's own heading element (h3). */}
            <AccordionTrigger className="font-display text-h3">{section.heading}</AccordionTrigger>
            <AccordionContent>
              <RichText
                value={section.body}
                siteOrigin={origin}
                className="[&>*:first-child]:mt-0"
              />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {entries.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              faqPageJsonLd({ url: absoluteUrl(origin, page.path), inLanguage: locale, entries }),
            ),
          }}
        />
      )}
    </>
  );
}

async function SellerDetails({ locale }: { locale: Locale }) {
  const [seller, t] = await Promise.all([
    getSellerInfo(),
    getTranslations({ locale, namespace: 'content.seller' }),
  ]);
  const rows = [
    ['companyName', seller.companyName],
    ['address', seller.address],
    ['phone', seller.phone],
    ['email', seller.email],
    ['taxCode', seller.taxCode],
  ] as const;
  const present = rows.filter(([, value]) => value);
  if (present.length === 0) return null;
  return (
    <section
      aria-labelledby="seller-details"
      className="border-line-200 mt-12 max-w-prose border-t pt-8"
    >
      <h2 id="seller-details" className="text-h3 mb-4">
        {t('title')}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {present.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-taupe-600">{t(key)}</dt>
            <dd>
              {key === 'email' ? (
                <a href={`mailto:${value}`} className="text-gold-700 underline underline-offset-4">
                  {value}
                </a>
              ) : key === 'phone' ? (
                <a
                  href={`tel:${value!.replace(/\s+/g, '')}`}
                  className="text-gold-700 underline underline-offset-4"
                >
                  {value}
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
