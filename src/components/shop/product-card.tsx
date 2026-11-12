import { useTranslations } from 'next-intl';

import { Price } from '@/components/ui/price';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ProductSummary } from '@/server/modules/catalog';

import { ProductImage } from './product-image';
import { WishlistButton } from './wishlist-button';

const CARD_SIZES =
  '(min-width: 1280px) 280px, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw';

/**
 * Listing card (§8.3): 4:5 image (second image on hover), wishlist heart, brand, name,
 * concentration, price.
 */
export function ProductCard({
  product,
  priority = false,
  headingLevel = 'h2',
}: {
  product: ProductSummary;
  priority?: boolean;
  headingLevel?: 'h2' | 'h3';
}) {
  const t = useTranslations('catalog');
  const [first, second] = product.images;
  const Heading = headingLevel;

  return (
    <article className="group relative flex flex-col gap-3" data-testid="product-card">
      <div className="relative overflow-hidden">
        <ProductImage
          image={first}
          alt={product.name}
          sizes={CARD_SIZES}
          priority={priority}
          className="ease-luxe transition-transform duration-(--duration-reveal) group-hover:scale-[1.03]"
        />
        {second && (
          <div className="ease-luxe absolute inset-0 opacity-0 transition-opacity duration-(--duration-reveal) group-hover:opacity-100">
            <ProductImage image={second} alt="" sizes={CARD_SIZES} />
          </div>
        )}
        {/* Above the card's full-size link overlay (z-10). */}
        <WishlistButton
          productId={product.id}
          productName={product.name}
          productSlug={product.slug}
          className="absolute top-2 right-2 z-10"
        />
      </div>
      <div className="flex flex-col gap-1">
        <p className="eyebrow text-taupe-600">{product.brand.name}</p>
        <Heading className="font-display text-h3 leading-snug font-medium">
          <Link
            href={{ pathname: '/products/[slug]', params: { slug: product.slug } }}
            className="after:absolute after:inset-0 hover:underline hover:underline-offset-4"
          >
            {product.name}
          </Link>
        </Heading>
        <p className="text-small text-taupe-600">{t(`concentration.${product.concentration}`)}</p>
        <Price
          amount={product.fromPrice}
          compareAtAmount={product.fromCompareAtPrice}
          from={product.hasPriceRange}
          className="text-small mt-1"
        />
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  className,
  priorityCount = 0,
  headingLevel = 'h2',
}: {
  products: ProductSummary[];
  className?: string;
  priorityCount?: number;
  headingLevel?: 'h2' | 'h3';
}) {
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4',
        className,
      )}
    >
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            priority={index < priorityCount}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
