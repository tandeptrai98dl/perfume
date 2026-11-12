import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '@/server/db/schema';
import { PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { newId } from '@/server/lib/ids';
import { catalogTags } from '@/server/modules/catalog';
import { generateOrderCode, transitionOrder, type OrderStatus } from '@/server/modules/order';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

/*
 * Best sellers refresh (§2 Discovery): an order that starts or stops counting (delivered,
 * paid, cancelled, returned) expires `catalogTags.bestSellers` through a throttled
 * `cache.revalidate` outbox job — at most one per slot plus one queued for the next slot.
 */

let h: CommandHarness;
const staff = { type: 'staff' as const, id: null, isManager: true };

type Job = { data: { tags: string[] }; singleton_key: string | null; start_after: Date };

async function refreshJobs(): Promise<Job[]> {
  const result = await h.db.execute<Job>(
    sql`select data, singleton_key, start_after from ${sql.identifier(PGBOSS_SCHEMA)}.job
        where name = 'cache.revalidate' and data->'tags' ? ${catalogTags.bestSellers}
        order by created_on`,
  );
  return result.rows;
}

async function insertOrder(status: OrderStatus, paymentStatus = 'unpaid'): Promise<string> {
  const id = newId();
  await h.db.insert(orders).values({
    id,
    code: generateOrderCode(),
    email: 'buyer@example.com',
    phone: '0912345678',
    customerName: 'Khách',
    locale: 'vi',
    status,
    paymentStatus: paymentStatus as never,
    paymentMethod: 'cod',
    subtotal: 1_000_000,
    total: 1_000_000,
  });
  return id;
}

async function transition(orderId: string, to: OrderStatus) {
  await h.db.transaction((tx) => transitionOrder(tx, h.boss, { orderId, to, actor: staff }));
}

beforeAll(async () => {
  h = await startCommandHarness();
});

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.db.execute(
    sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = 'cache.revalidate'`,
  );
});

describe('best sellers refresh on order changes', () => {
  it('enqueues a throttled refresh when an unpaid COD order is delivered', async () => {
    await transition(await insertOrder('shipped'), 'delivered');
    const jobs = await refreshJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.tags).toEqual([catalogTags.bestSellers]);
    expect(jobs[0]!.singleton_key).toBe(catalogTags.bestSellers);
  });

  it('keeps a burst to the current slot plus one in the next slot', async () => {
    for (let i = 0; i < 4; i++) await transition(await insertOrder('shipped'), 'delivered');
    const jobs = await refreshJobs();
    expect(jobs).toHaveLength(2);
    expect(new Date(jobs[1]!.start_after).getTime()).toBeGreaterThan(
      new Date(jobs[0]!.start_after).getTime(),
    );
  });

  it('refreshes when a paid order is cancelled, not when an unpaid one is', async () => {
    await transition(await insertOrder('pending'), 'cancelled');
    expect(await refreshJobs()).toHaveLength(0);
    await transition(await insertOrder('confirmed', 'paid'), 'cancelled');
    expect(await refreshJobs()).toHaveLength(1);
  });

  it('ignores changes that do not move the order in or out of the ranking', async () => {
    // Paid online: already counted before delivery.
    await transition(await insertOrder('shipped', 'paid'), 'delivered');
    expect(await refreshJobs()).toHaveLength(0);
  });
});
