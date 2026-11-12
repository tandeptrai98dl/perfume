import { and, eq, isNull } from 'drizzle-orm';

import { users } from '@/server/db/schema';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { toCsv } from '@/server/modules/audit';

import { listCustomersForExport } from './admin-queries';
import { COD_RISK_ACTION, CUSTOMER_EXPORT_LIMIT, CUSTOMER_NOTE_ACTION } from './admin-constants';
import { canSeeCustomerContact } from './admin-rules';
import type { CustomerFilter, CustomerNoteInput, SetCodRiskFlagInput } from './admin-schemas';

/*
 * Admin customer commands (§11.2 "Customers"). `/admin/customers` is Owner + Manager
 * (`customers.view`, §11.1); the COD risk flag (D16) and internal notes are changed there by
 * the same roles. Notes and risk changes are append-only audit rows on the account
 * (`entity_type = 'user'`): no customer-notes table exists in MVP (§6.2).
 */

async function lockCustomer(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ id: users.id, codRiskFlag: users.codRiskFlag })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, 'customer'), isNull(users.deletedAt)))
    .for('update');
  if (!user) throw new DomainError('notFound');
  return user;
}

/** Sets or clears `users.cod_risk_flag` with a reason (audited). */
export async function setCodRiskFlag(
  ctx: CommandContext,
  input: SetCodRiskFlagInput,
): Promise<CommandResult<{ userId: string; codRiskFlag: boolean }>> {
  assertCan(ctx.actor, 'customers.view');
  return ctx.db.transaction(async (tx) => {
    const user = await lockCustomer(tx, input.userId);
    if (user.codRiskFlag === input.flagged) {
      throw new DomainError('invalid', [{ path: 'flagged', code: 'riskUnchanged' }]);
    }
    await tx.update(users).set({ codRiskFlag: input.flagged }).where(eq(users.id, user.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: COD_RISK_ACTION,
      entityType: 'user',
      entityId: user.id,
      diff: {
        codRiskFlag: { from: user.codRiskFlag, to: input.flagged },
        reason: { from: null, to: input.reason },
      },
      ip: ctx.ip,
    });
    // Admin screens are dynamic: the action's refresh() re-renders them.
    return { data: { userId: user.id, codRiskFlag: input.flagged }, tags: [] };
  });
}

/** Internal staff note on a customer account (append-only audit row). */
export async function addCustomerNote(
  ctx: CommandContext,
  input: CustomerNoteInput,
): Promise<CommandResult<{ userId: string }>> {
  assertCan(ctx.actor, 'customers.view');
  return ctx.db.transaction(async (tx) => {
    const user = await lockCustomer(tx, input.userId);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: CUSTOMER_NOTE_ACTION,
      entityType: 'user',
      entityId: user.id,
      diff: { note: { from: null, to: input.note } },
      ip: ctx.ip,
    });
    return { data: { userId: user.id }, tags: [] };
  });
}

const EXPORT_HEADER = [
  'customer_key',
  'type',
  'name',
  'phone',
  'email',
  'locale',
  'orders',
  'lifetime_spend_vnd',
  'last_order_at',
  'failed_deliveries',
  'cod_risk_flag',
  'customer_since',
];

/**
 * CSV export of the filtered customer list (§11.1 "Export customer data (CSV)": Owner,
 * `customers.export`). Capped at CUSTOMER_EXPORT_LIMIT rows, formula-injection safe (shared
 * audit CSV helpers) and audited with its filters and row count (no customer data in the
 * audit row).
 */
export async function exportCustomersCsv(
  ctx: Pick<CommandContext, 'db' | 'actor' | 'ip'>,
  filter: CustomerFilter,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  assertCan(ctx.actor, 'customers.export');
  const { rows, truncated } = await listCustomersForExport(ctx.db, filter, {
    contactVisible: canSeeCustomerContact(ctx.actor.role),
    limit: CUSTOMER_EXPORT_LIMIT,
  });
  const csv = toCsv(
    EXPORT_HEADER,
    rows.map((row) => [
      row.key,
      row.type,
      row.name,
      row.phone ?? '',
      row.email ?? '',
      row.locale,
      row.orderCount,
      row.lifetimeSpend,
      row.lastOrderAt ?? '',
      row.failedDeliveries,
      row.codRiskFlag,
      row.since,
    ]),
  );
  await recordAudit(ctx.db, {
    actorId: ctx.actor.id,
    action: 'customer.export',
    entityType: 'user',
    entityId: null,
    diff: {
      filter: Object.fromEntries(
        Object.entries(filter).filter(([, value]) => value !== undefined && value !== ''),
      ),
      rows: rows.length,
      truncated,
    },
    ip: ctx.ip,
  });
  return { csv, rows: rows.length, truncated };
}
