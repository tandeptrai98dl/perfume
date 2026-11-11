/** Whole-percent discount between a compare-at price and the selling price (VND integers). */
export function discountPercent(price: number, compareAtPrice?: number | null): number | null {
  if (!compareAtPrice || compareAtPrice <= price || price < 0) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}
