import { runEinvoiceJob } from '@/server/modules/einvoice';

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
  } as const;
}
