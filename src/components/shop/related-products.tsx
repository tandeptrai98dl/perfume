import { useTranslations } from 'next-intl';

import type { ProductSummary } from '@/server/modules/catalog';

import { ProductGrid } from './product-card';

/** Same family or brand (§10.1 discovery). */
export function RelatedProducts({ products }: { products: ProductSummary[] }) {
  const t = useTranslations('product');
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="related-products" className="flex flex-col gap-8">
      <h2 id="related-products" className="text-h2">
        {t('related')}
      </h2>
      <ProductGrid products={products} headingLevel="h3" />
    </section>
  );
}
