import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ProductGrid } from '@/components/shop/product-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';
import type { ProductSummary } from '@/server/modules/catalog';

/**
 * WishlistGrid (§8.3 Account): the member's saved products as product cards (each heart
 * removes it), or the empty state.
 */
export function WishlistGrid({ products }: { products: ProductSummary[] }) {
  const t = useTranslations('wishlist.page');
  if (products.length === 0) {
    return (
      <EmptyState
        className="border-line-200 border"
        icon={<Heart aria-hidden />}
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={
          <Button asChild variant="secondary">
            <Link href="/perfumes">{t('browse')}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid="wishlist-grid">
      <p className="text-small text-taupe-600" aria-live="polite">
        {t('count', { count: products.length })}
      </p>
      <ProductGrid products={products} className="lg:grid-cols-3" />
    </div>
  );
}
