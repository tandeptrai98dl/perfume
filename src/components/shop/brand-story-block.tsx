import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { ProductDetail } from '@/server/modules/catalog';

import { RichText, hasRichText } from './rich-text';

/** Brand introduction on the PDP with a link to the brand page (§13.1 internal links). */
export function BrandStoryBlock({ brand }: { brand: ProductDetail['brand'] }) {
  const t = useTranslations('product');
  return (
    <section aria-labelledby="brand-story" className="bg-sand-100 flex flex-col gap-4 p-6 md:p-10">
      <h2 id="brand-story" className="text-h2">
        {t('brandStory', { brand: brand.name })}
      </h2>
      {hasRichText(brand.story) && (
        <RichText doc={brand.story} className="max-w-2xl text-taupe-600" />
      )}
      {brand.slug && (
        <Link
          href={{ pathname: '/brands/[slug]', params: { slug: brand.slug } }}
          className="text-gold-700 inline-flex min-h-11 items-center self-start underline underline-offset-4"
        >
          {t('viewBrand', { brand: brand.name })}
        </Link>
      )}
    </section>
  );
}
