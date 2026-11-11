import type { HandlerDeps } from '.';

import { notImplemented } from './not-implemented';

/**
 * Customer emails in the order's locale + staff alerts (§10.5, ADR-0019).
 * Owner: M2 stream "notifications & account".
 */
export function createOrderNotificationHandlers(deps: HandlerDeps) {
  void deps;
  return {
    'order.placed': notImplemented('order.placed'),
    'order.status-changed': notImplemented('order.status-changed'),
    'payment.received': notImplemented('payment.received'),
    'staff.alert': notImplemented('staff.alert'),
    'auth.email': notImplemented('auth.email'),
  } as const;
}
