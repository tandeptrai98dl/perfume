import type { PgBoss } from 'pg-boss';

import { enqueue } from '@/server/jobs/queue';
import type { Tx } from '@/server/lib/command-context';
import { takeReturnPhotosForSubject, type OrderSubject } from '@/server/modules/order';

/**
 * Privacy deletion step (PDPL 91/2025; `ErasureStep` of the customer module): the subject's
 * return photos are unlinked from their requests in the anonymisation transaction and the
 * private objects are deleted by the `returns.delete-photos` outbox job once it commits.
 * Must run before the orders are anonymised (guest orders are matched by e-mail).
 */
export async function eraseReturnPhotosForSubject(
  tx: Tx,
  boss: PgBoss,
  subject: OrderSubject,
): Promise<number> {
  const keys = await takeReturnPhotosForSubject(tx, subject);
  for (let start = 0; start < keys.length; start += 50) {
    await enqueue(boss, tx, 'returns.delete-photos', { keys: keys.slice(start, start + 50) });
  }
  return keys.length;
}
