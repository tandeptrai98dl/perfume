import type { HandlerDeps } from '.';

import { notImplemented } from './not-implemented';

/**
 * Cron jobs that move orders on time limits (ADR-0006): unpaid online orders, unconfirmed COD
 * orders, delivered → completed. Owner: M2 stream "payments".
 */
export function createOrderTimeoutHandlers(deps: HandlerDeps) {
  void deps;
  return {
    'orders.expire-unpaid': notImplemented('orders.expire-unpaid'),
    'orders.cancel-unconfirmed-cod': notImplemented('orders.cancel-unconfirmed-cod'),
    'orders.complete-delivered': notImplemented('orders.complete-delivered'),
  } as const;
}
