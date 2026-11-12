import type { Database } from '@/server/db/client';
import { getVariantStock } from '@/server/modules/inventory';
import type { StaffAlertDetails } from '@/server/modules/notification';
import { countPendingReviews } from '@/server/modules/review';

import type { JobPayload } from '../definitions';

/**
 * Details of the M3 wave 2 staff alerts, read when the alert is sent so it shows current
 * figures (catalogue data and counters only, ADR-0019). Composed here, in the worker layer,
 * because the notification module must not depend on the inventory/review modules.
 *
 * - `{ skip }`: nothing worth sending any more (variant deleted or no longer sold, no review
 *   left to moderate);
 * - `{ details: null }`: an alert without structured details (every other kind).
 */
export async function resolveStaffAlertDetails(
  db: Database,
  payload: JobPayload<'staff.alert'>,
): Promise<{ skip: string } | { details: StaffAlertDetails | null }> {
  if (payload.kind === 'low_stock' && payload.variantId) {
    const stock = await getVariantStock(db, payload.variantId);
    if (!stock || !stock.isActive) return { skip: 'variant_inactive' };
    return {
      details: {
        kind: 'low_stock',
        variantId: stock.variantId,
        sku: stock.sku,
        productName: stock.productName,
        available: stock.available,
        threshold: stock.lowStockThreshold,
      },
    };
  }
  if (payload.kind === 'review_pending') {
    const pending = await countPendingReviews(db);
    if (pending === 0) return { skip: 'nothing_pending' };
    return { details: { kind: 'review_pending', pending } };
  }
  if (payload.kind === 'job_failed' && payload.job) {
    return {
      details: {
        kind: 'job_failed',
        job: payload.job.name,
        id: payload.job.id,
        attempts: payload.job.attempts,
      },
    };
  }
  return { details: null };
}
