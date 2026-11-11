import type { FieldIssue } from '@/server/lib/command-context';

import type { VariantInput } from './admin-schemas';

/**
 * Field-level permission rules for variants (ARCHITECTURE.md §11.1): content editors may edit
 * a product but not its prices. Without `products.editPrices`:
 * - price fields of existing variants must stay unchanged (the UI shows them read-only);
 * - variants cannot be added, because a new variant needs a price.
 * Requests that break a rule are rejected, never silently corrected.
 */

export const PRICE_FIELDS = ['price', 'compareAtPrice', 'costPrice'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export type VariantPrices = Record<PriceField, number | null>;

export function priceFieldViolations(
  existing: ReadonlyMap<string, VariantPrices>,
  incoming: readonly Pick<VariantInput, 'id' | PriceField>[],
  canEditPrices: boolean,
): FieldIssue[] {
  if (canEditPrices) return [];
  const issues: FieldIssue[] = [];
  incoming.forEach((variant, index) => {
    const current = variant.id ? existing.get(variant.id) : undefined;
    if (!current) {
      issues.push({ path: `variants.${index}`, code: 'forbiddenField' });
      return;
    }
    for (const field of PRICE_FIELDS) {
      if ((variant[field] ?? null) !== (current[field] ?? null)) {
        issues.push({ path: `variants.${index}.${field}`, code: 'forbiddenField' });
      }
    }
  });
  return issues;
}

/**
 * Saved variants are never deleted from the editor (stock movements and, later, orders refer
 * to them): they are deactivated instead. Every existing id must be present, and every id sent
 * must belong to the product.
 */
export function variantSetIssues(
  existingIds: ReadonlySet<string>,
  incoming: readonly Pick<VariantInput, 'id'>[],
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const sent = new Set<string>();
  incoming.forEach((variant, index) => {
    if (!variant.id) return;
    if (!existingIds.has(variant.id)) issues.push({ path: `variants.${index}`, code: 'invalid' });
    sent.add(variant.id);
  });
  for (const id of existingIds) {
    if (!sent.has(id)) {
      issues.push({ path: 'variants', code: 'variantsMissing' });
      break;
    }
  }
  return issues;
}
