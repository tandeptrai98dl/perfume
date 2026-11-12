import type { ProductSummary } from '@/server/modules/catalog';

import { ProductCard } from './product-card';

/**
 * Horizontal product rail (§8.3 home rails: new arrivals, best sellers). Swipe/scroll on small
 * screens with scroll snapping, four cards per view from `lg` (the rest scroll). Plain list of
 * cards: every card link is reachable with Tab, and focusing one scrolls it into view.
 */
export function ProductRail({
  products,
  label,
  testId,
}: {
  products: ProductSummary[];
  /** Accessible name of the list (the section heading). */
  label: string;
  testId?: string;
}) {
  return (
    <ul
      aria-label={label}
      data-testid={testId}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:scroll-px-6 md:gap-6 md:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0"
    >
      {products.map((product) => (
        <li
          key={product.id}
          className="w-[44%] shrink-0 snap-start md:w-[30%] lg:w-[calc((100%-4.5rem)/4)]"
        >
          <ProductCard product={product} headingLevel="h3" />
        </li>
      ))}
    </ul>
  );
}
