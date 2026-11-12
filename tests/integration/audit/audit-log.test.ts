import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  auditPageSchema,
  exportAuditLogCsv,
  listAuditEntityTypes,
  listAuditLogs,
} from '@/server/modules/audit';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

/* Audit log read side: keyset pagination, filters, redaction and the audited CSV export. */

let h: CommandHarness;
const TOTAL = 125;

const page = (input: Record<string, unknown>, size = 50) =>
  listAuditLogs(h.db, auditPageSchema.parse(input), size);

beforeAll(async () => {
  h = await startCommandHarness();
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    // Ids are generated in order, so id order = insertion order (UUIDv7).
    id: newId(),
    actorId: i % 5 === 0 ? h.actorIds.manager : h.actorIds.owner,
    action:
      i % 3 === 0 ? 'order.status.confirmed' : i % 3 === 1 ? 'product.update' : 'staff.role_change',
    entityType: i % 3 === 0 ? 'order' : i % 3 === 1 ? 'product' : 'staff',
    entityId: `entity-${i}`,
    diff: { status: { from: 'a', to: 'b' }, index: i },
    ip: '203.113.4.17',
    // Two rows a day, from 1 March 2031 (Vietnam time, 08:00).
    createdAt: new Date(Date.UTC(2031, 2, 1 + Math.floor(i / 2), 1, i % 60)),
  }));
  for (const row of rows) await h.db.insert(auditLogs).values(row);
  await h.db.insert(auditLogs).values({
    actorId: null,
    action: 'order.status.cancelled',
    entityType: 'order',
    entityId: 'contact-row',
    diff: {
      email: { from: 'old@khach.vn', to: 'new@khach.vn' },
      reason: { from: null, to: 'Khách gọi 0912 345 678, email huong@khach.vn' },
    },
    ip: '2001:ee0:4f0a:1::5',
    createdAt: new Date(Date.UTC(2031, 5, 1)),
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('listAuditLogs', () => {
  it('walks every row exactly once with keyset pages, both directions', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const firstIds: string[] = [];
    const cursors: (string | null)[] = [];
    do {
      cursors.push(cursor);
      const result = await page(cursor ? { cursor } : {});
      seen.push(...result.rows.map((row) => row.id));
      firstIds.push(result.rows[0]!.id);
      if (pages === 0) expect(result.newerCursor).toBeNull();
      else expect(result.newerCursor).toBe(result.rows[0]!.id);
      cursor = result.olderCursor;
      pages += 1;
    } while (cursor);
    expect(seen).toHaveLength(TOTAL + 1);
    expect(new Set(seen).size).toBe(TOTAL + 1);
    // Newest first.
    expect([...seen].sort().reverse()).toEqual(seen);
    expect(pages).toBe(3);

    // "Newer" from the second page returns exactly the first page.
    const second = await page({ cursor: cursors[1] });
    expect(second.rows[0]!.id).toBe(firstIds[1]);
    const back = await page({ cursor: second.newerCursor, dir: 'newer' });
    expect(back.rows[0]!.id).toBe(firstIds[0]);
    expect(back.newerCursor).toBeNull();
    expect(back.olderCursor).toBe(back.rows.at(-1)!.id);
  });

  it('filters by actor, entity, action prefix and Vietnam dates', async () => {
    const byManager = await page({ actorId: h.actorIds.manager }, 200);
    expect(byManager.rows).toHaveLength(25);
    expect(byManager.rows.every((row) => row.actorName === 'manager')).toBe(true);

    const orders = await page({ entityType: 'order' }, 200);
    expect(orders.rows.every((row) => row.entityType === 'order')).toBe(true);
    expect(orders.rows[0]!.href).toBe('/admin/orders/contact-row');

    const prefix = await page({ action: 'staff.' }, 200);
    expect(prefix.rows.length).toBeGreaterThan(0);
    expect(prefix.rows.every((row) => row.action.startsWith('staff.'))).toBe(true);
    // LIKE wildcards in the filter are literal.
    expect((await page({ action: 'staff_' }, 200)).rows).toHaveLength(0);

    const entity = await page({ entityId: 'entity-7' });
    expect(entity.rows.map((row) => row.entityId)).toEqual(['entity-7']);

    const day = await page({ from: '2031-03-02', to: '2031-03-02' }, 200);
    expect(day.rows.map((row) => row.entityId).sort()).toEqual(['entity-2', 'entity-3']);
  });

  it('never returns contact data or full IPs', async () => {
    const [row] = (await page({ entityId: 'contact-row' })).rows;
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/old@khach|new@khach|huong@khach|345 678/);
    expect(row!.diff).toMatchObject({ email: { from: '[redacted]', to: '[redacted]' } });
    expect(row!.ip).toBe('2001:ee0:4f0a:*');
    expect(row!.actorId).toBeNull();
    const [other] = (await page({ entityId: 'entity-1' })).rows;
    expect(other!.ip).toBe('203.113.4.*');
    // jsonb does not keep key order.
    expect(other!.changes).toHaveLength(2);
    expect(other!.changes).toEqual(
      expect.arrayContaining([
        { field: 'status', kind: 'change', from: 'a', to: 'b' },
        { field: 'index', kind: 'value', value: 1 },
      ]),
    );
  });

  it('lists the distinct entity types', async () => {
    expect(await listAuditEntityTypes(h.db)).toEqual(['order', 'product', 'staff']);
  });
});

describe('exportAuditLogCsv', () => {
  it('exports the filtered rows for an Owner and audits the export', async () => {
    const result = await exportAuditLogCsv(
      h.ctx('owner'),
      auditPageSchema.parse({ entityType: 'order' }),
    );
    const lines = result.csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('created_at,actor,actor_role,action,entity_type,entity_id,diff,ip');
    expect(lines).toHaveLength(result.rows + 1);
    expect(result.csv).not.toMatch(/old@khach|huong@khach|203\.113\.4\.17/);

    const [audit] = await h.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'audit_log.export'));
    expect(audit).toMatchObject({ actorId: h.actorIds.owner, entityType: 'audit_log' });
    expect(audit!.diff).toMatchObject({ filter: { entityType: 'order' }, rows: result.rows });
  });

  it('is refused to a Manager (no customers.export)', async () => {
    await expect(
      exportAuditLogCsv(h.ctx('manager'), auditPageSchema.parse({})),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
