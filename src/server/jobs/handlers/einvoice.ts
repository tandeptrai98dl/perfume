import { runEinvoiceAdjustmentJob, runEinvoiceJob } from '@/server/modules/einvoice';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * `einvoice.issue` (D13): issues the order's e-invoice through the configured provider. A
 * retryable failure throws after it was recorded, so pg-boss retries with backoff; final
 * failures complete the job (the staff alert is already queued). Owner: M3 e-invoicing stream.
 */
export function createEinvoiceHandlers(deps: HandlerDeps) {
  return {
    'einvoice.issue': async ({ orderId }: JobPayload<'einvoice.issue'>) => {
      await runEinvoiceJob(
        { db: deps.db, boss: deps.boss, provider: deps.einvoice ?? null },
        orderId,
      );
    },
    // M3 wave 2 returns: cancel / replace an issued invoice (returns, staff corrections).
    'einvoice.adjust': async (payload: JobPayload<'einvoice.adjust'>) => {
      await runEinvoiceAdjustmentJob(
        { db: deps.db, boss: deps.boss, provider: deps.einvoice ?? null },
        payload,
      );
    },
  } as const;
}
