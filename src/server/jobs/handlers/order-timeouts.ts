import {
  cancelUnconfirmedCodOrders,
  completeDeliveredOrders,
  expireUnpaidOrders,
} from '@/server/modules/payment';

import type { HandlerDeps } from '.';

/**
 * Cron jobs that move orders on time limits (ADR-0006): unpaid online orders, unconfirmed COD
 * orders, delivered → completed. Owner: M2 stream "payments". Each run is idempotent and
 * skips rows locked by concurrent work (see `server/modules/payment/timeouts.ts`).
 */
export function createOrderTimeoutHandlers(deps: HandlerDeps) {
  const timeoutDeps = { db: deps.db, boss: deps.boss };
  return {
    'orders.expire-unpaid': async () => {
      await expireUnpaidOrders(timeoutDeps);
    },
    'orders.cancel-unconfirmed-cod': async () => {
      await cancelUnconfirmedCodOrders(timeoutDeps);
    },
    'orders.complete-delivered': async () => {
      await completeDeliveredOrders(timeoutDeps);
    },
  } as const;
}
