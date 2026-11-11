import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orders } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';

import { ORDER_CODE_PATTERN } from './codes';
import { normalizeOrderCode } from './customer-queries';
import { customerCanCancel, type OrderStatus } from './state-machine';
import { transitionOrder, type TransitionResult } from './transition';

/** Stored in `orders.cancel_reason` / the order timeline when the customer cancels. */
export const CUSTOMER_CANCEL_REASON = 'customer_request';

/**
 * A signed-in customer cancels their own order before processing (§10.5). The lookup is
 * scoped by `user_id` (another customer's code is `notFound`, never `forbidden`), and
 * `transitionOrder` re-checks the state machine under the row lock, so a concurrent staff
 * confirmation wins cleanly.
 */
export async function cancelCustomerOrder(
  db: Database,
  boss: PgBoss,
  input: { userId: string; code: string },
): Promise<TransitionResult> {
  const code = normalizeOrderCode(input.code);
  if (!ORDER_CODE_PATTERN.test(code)) throw new DomainError('notFound');
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.code, code), eq(orders.userId, input.userId)))
      .limit(1);
    if (!order) throw new DomainError('notFound');
    if (!customerCanCancel(order.status as OrderStatus)) {
      throw new DomainError('invalid', [{ path: 'status', code: 'notCancellable' }]);
    }
    return transitionOrder(tx, boss, {
      orderId: order.id,
      to: 'cancelled',
      actor: { type: 'customer', id: input.userId },
      reason: CUSTOMER_CANCEL_REASON,
    });
  });
}
