import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderItems, orders } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type FieldIssue,
  type Tx,
} from '@/server/lib/command-context';
import { catalogTags } from '@/server/modules/catalog/cache-tags';
import type { CouponRejection } from '@/server/modules/checkout/pricing';
import { resolveWard } from '@/server/modules/customer';
import { activeReservationExpiry, adjustOrderStock } from '@/server/modules/inventory';
import {
  editPaymentEffect,
  openRefundTotal,
  settleOrderAfterEdit,
  type EditPaymentEffect,
} from '@/server/modules/payment';
import { getCouponTerms, syncOrderRedemption } from '@/server/modules/promotion';
import { getCommerceSettings } from '@/server/modules/settings';
import { quoteShipping } from '@/server/modules/shipping';

import { orderTags } from './admin-commands';
import {
  buildEditLines,
  canEditOrder,
  diffAddress,
  diffLines,
  diffTotals,
  nextDepositRequired,
  repriceOrder,
  stockChanges,
  stockModeFor,
  type EditAddress,
  type LineDiff,
  type PlannedLine,
} from './admin-edit-plan';
import {
  currentShippingFeeOverride,
  getCurrentLines,
  getShippingAddress,
  loadEditCatalog,
  ORDER_EDITED_EVENT,
  searchEditVariants,
  type EditVariantOption,
} from './admin-edit-queries';
import type { EditVariantSearchInput, OrderEditInput } from './admin-edit-schemas';
import { staffOrderActor } from './admin-view';
import type { OrderStatus } from './state-machine';
import { lockOrder, recordOrderEvent } from './transition';

/*
 * Admin order edit before shipment (ARCHITECTURE.md §3.4 step 8, §11.2 "Order edits",
 * ADR-0005/0006/0009). One transaction:
 *   lock order (optimistic version check) → plan (address, lines, totals with `priceCart`,
 *   coupon kept or dropped, shipping rate or manager override) → stock deltas (reservations
 *   or committed stock, inventory rows locked in variant order) → coupon redemption → rewrite
 *   items/address/totals (version + 1) → `edited` event with the before/after diff → payment
 *   consequences in the payment module (status, refund of the excess, stale sessions, pending
 *   order covered) → audit → `order.updated` customer e-mail + cache revalidation (outbox).
 * `previewOrderEdit` runs the same plan without writing, so staff see the diff and the money
 * difference before saving.
 */

type Executor = Pick<Database, 'select' | 'execute'>;
type OrderRow = typeof orders.$inferSelect;

type Totals = {
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
};

export type EditCouponOutcome =
  { code: string; kept: true } | { code: string; kept: false; reason: CouponRejection | 'deleted' };

export type EditPreviewLine = {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  discountAllocated: number;
  lineTotal: number;
  isNew: boolean;
};

export type OrderEditPreview = {
  orderId: string;
  code: string;
  version: number;
  status: OrderStatus;
  changed: boolean;
  before: Totals;
  after: Totals;
  lines: EditPreviewLine[];
  lineDiff: LineDiff[];
  addressFields: (keyof EditAddress)[];
  coupon: EditCouponOutcome | null;
  shipping: { rateId: string | null; rateName: string | null; override: number | null };
  payment: EditPaymentEffect & { amountPaid: number; difference: number };
  /** Problems that block saving (`items.<i>.quantity`, `address.*`, `shipping`, …). */
  issues: FieldIssue[];
};

type Plan = OrderEditPreview & {
  order: OrderRow;
  planned: PlannedLine[];
  moneyChanged: boolean;
  addressAfter: EditAddress;
  addressDiff: ReturnType<typeof diffAddress>;
  lineDiscounts: Record<string, number>;
  couponAmount: number;
  overrideBefore: number | null;
  current: Awaited<ReturnType<typeof getCurrentLines>>;
};

function totalsOf(order: OrderRow): Totals {
  return {
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    depositRequired: order.depositRequired,
  };
}

function assertEditable(order: OrderRow) {
  if (!canEditOrder(order.status as OrderStatus)) {
    throw new DomainError('invalid', [{ path: 'status', code: 'orderNotEditable' }]);
  }
}

async function planEdit(
  db: Executor,
  ctx: CommandContext,
  order: OrderRow,
  input: OrderEditInput,
): Promise<Plan> {
  const status = order.status as OrderStatus;
  const issues: FieldIssue[] = [];
  const actor = staffOrderActor(ctx.actor);
  if (input.shippingFeeOverride && !actor.isManager) {
    // §3.4 step 8: overriding the shipping fee is a Manager/Owner decision.
    throw new DomainError('forbidden', [
      { path: 'shippingFeeOverride.amount', code: 'overrideForbidden' },
    ]);
  }

  // Sequential on purpose: inside the edit transaction all reads share one connection.
  const current = await getCurrentLines(db, order.id);
  const addressBefore = await getShippingAddress(db, order.id);
  const overrideBefore = await currentShippingFeeOverride(db, order.id);
  const settings = await getCommerceSettings(db);
  const ward = await resolveWard(db, input.address);
  if (!ward.ok) issues.push({ path: `address.${ward.field}`, code: ward.code });
  const addressAfter: EditAddress = {
    fullName: input.address.fullName,
    phone: input.address.phone,
    provinceCode: ward.ok ? ward.province.code : input.address.provinceCode,
    provinceName: ward.ok ? ward.province.name : (addressBefore?.provinceName ?? ''),
    wardCode: ward.ok ? ward.ward.code : input.address.wardCode,
    wardName: ward.ok ? ward.ward.name : (addressBefore?.wardName ?? ''),
    street: input.address.street,
  };

  const catalog = await loadEditCatalog(
    db,
    [...current.map((line) => line.variantId), ...input.items.map((line) => line.variantId)],
    order.locale,
  );
  const built = buildEditLines(current, input.items, catalog, settings.cart.maxQuantityPerLine);
  issues.push(...built.issues);
  const planned = built.lines;

  const override = input.shippingFeeOverride ? input.shippingFeeOverride.amount : overrideBefore;
  const lineDiff = diffLines(current, planned);
  const addressDiff = diffAddress(addressBefore, addressAfter);
  const provinceChanged = addressBefore?.provinceCode !== addressAfter.provinceCode;
  const moneyChanged = lineDiff.length > 0 || provinceChanged || override !== overrideBefore;

  const before = totalsOf(order);
  let after = before;
  let lineDiscounts: Record<string, number> = {};
  let couponAmount = 0;
  let coupon: EditCouponOutcome | null = order.couponCode
    ? { code: order.couponCode, kept: true }
    : null;
  let rate: { rateId: string; name: string } | null = null;

  if (moneyChanged && built.issues.length === 0) {
    const weightG = planned.reduce((sum, line) => sum + line.weightG * line.quantity, 0);
    const quotes = ward.ok
      ? await quoteShipping(db, {
          provinceCode: addressAfter.provinceCode,
          weightG,
          locale: order.locale,
        })
      : [];
    const quote =
      quotes.find((candidate) => candidate.rateId === order.shippingRateId) ?? quotes[0] ?? null;
    if (quote) rate = { rateId: quote.rateId, name: quote.name };
    if (!quote && override === null && ward.ok) {
      issues.push({ path: 'shipping', code: 'shippingRateUnavailable' });
    }
    const terms = order.couponCode ? await getCouponTerms(db, order.couponCode) : null;
    if (order.couponCode && !terms)
      coupon = { code: order.couponCode, kept: false, reason: 'deleted' };
    const priced = repriceOrder({
      lines: planned,
      coupon: terms,
      shippingRate: quote ? { fee: quote.fee, freeOverSubtotal: quote.freeOverSubtotal } : null,
      shippingFeeOverride: override,
      // Gift wrap keeps the fee charged at checkout.
      giftWrap: { enabled: order.giftWrap, fee: order.giftWrapFee },
      cod: settings.cod,
      paymentMethod: order.paymentMethod,
    });
    if (priced.couponDropped) {
      coupon = {
        code: priced.couponDropped.code,
        kept: false,
        reason: priced.couponDropped.reason,
      };
    }
    after = {
      subtotal: priced.totals.subtotal,
      discountTotal: priced.totals.discountTotal,
      shippingFee: priced.totals.shippingFee,
      giftWrapFee: priced.totals.giftWrapFee,
      total: priced.totals.total,
      depositRequired:
        order.paymentMethod === 'cod'
          ? nextDepositRequired(status, priced.totals.depositRequired, order.depositRequired)
          : 0,
    };
    lineDiscounts = priced.totals.lineDiscounts;
    couponAmount = priced.totals.couponAmount;
    if (order.paymentMethod === 'cod' && status === 'pending' && after.depositRequired <= 0) {
      // A pending COD order waits for its deposit; with no deposit left there is no valid
      // transition back to staff confirmation (§3.5). Cancel and re-create instead.
      issues.push({ path: 'total', code: 'depositNoLongerRequired' });
    }
  }

  const payment = editPaymentEffect({
    paymentMethod: order.paymentMethod,
    total: after.total,
    depositRequired: after.depositRequired,
    amountPaid: order.amountPaid,
    amountRefunded: order.amountRefunded,
    openRefunds: await openRefundTotal(db, order.id),
  });

  const discountsBefore = new Map<string, number>();
  if (!moneyChanged) {
    const rows = await db
      .select({ variantId: orderItems.variantId, discount: orderItems.discountAllocated })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    for (const row of rows) discountsBefore.set(row.variantId, row.discount);
  }
  const lines: EditPreviewLine[] = planned.map((line) => {
    const discount = moneyChanged
      ? (lineDiscounts[line.variantId] ?? 0)
      : (discountsBefore.get(line.variantId) ?? 0);
    return {
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      variantLabel: line.variantLabel,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountAllocated: discount,
      lineTotal: line.unitPrice * line.quantity - discount,
      isNew: line.isNew,
    };
  });

  const addressFields = Object.keys(addressDiff) as (keyof EditAddress)[];
  return {
    orderId: order.id,
    code: order.code,
    version: order.version,
    status,
    changed: moneyChanged || addressFields.length > 0,
    before,
    after,
    lines,
    lineDiff,
    addressFields,
    coupon,
    shipping: {
      rateId: rate?.rateId ?? order.shippingRateId,
      rateName: rate?.name ?? null,
      override,
    },
    payment: { ...payment, amountPaid: order.amountPaid, difference: after.total - before.total },
    issues,
    order,
    planned,
    moneyChanged,
    addressAfter,
    addressDiff,
    lineDiscounts,
    couponAmount,
    overrideBefore,
    current,
  };
}

function publicPreview(plan: Plan): OrderEditPreview {
  return {
    orderId: plan.orderId,
    code: plan.code,
    version: plan.version,
    status: plan.status,
    changed: plan.changed,
    before: plan.before,
    after: plan.after,
    lines: plan.lines,
    lineDiff: plan.lineDiff,
    addressFields: plan.addressFields,
    coupon: plan.coupon,
    shipping: plan.shipping,
    payment: plan.payment,
    issues: plan.issues,
  };
}

/** Server-computed preview of an edit (no writes): new totals, diff, money consequence. */
export async function previewOrderEdit(
  ctx: CommandContext,
  input: OrderEditInput,
): Promise<CommandResult<OrderEditPreview>> {
  assertCan(ctx.actor, 'orders.editBeforeShipping');
  const [order] = await ctx.db.select().from(orders).where(eq(orders.id, input.orderId));
  if (!order) throw new DomainError('notFound');
  if (order.version !== input.expectedVersion) throw new DomainError('conflict');
  assertEditable(order);
  return { data: publicPreview(await planEdit(ctx.db, ctx, order, input)), tags: [] };
}

export type OrderEditResult = {
  orderId: string;
  code: string;
  version: number;
  total: number;
  onlineDue: number;
  refund: number;
  refundId: string | null;
  couponDropped: string | null;
};

function stockIssues(error: DomainError, items: OrderEditInput['items']): FieldIssue[] {
  return error.fieldErrors.map((issue) => {
    const index = items.findIndex((item) => item.variantId === issue.path);
    return {
      path: index >= 0 ? `items.${index}.quantity` : 'items',
      code: 'itemInsufficientStock',
    };
  });
}

async function writeLines(tx: Tx, plan: Plan): Promise<void> {
  const keep = new Set(plan.planned.map((line) => line.variantId));
  const removed = plan.current.filter((line) => !keep.has(line.variantId)).map((l) => l.variantId);
  if (removed.length > 0) {
    await tx
      .delete(orderItems)
      .where(and(eq(orderItems.orderId, plan.order.id), inArray(orderItems.variantId, removed)));
  }
  for (const line of plan.planned) {
    const discount = plan.lineDiscounts[line.variantId] ?? 0;
    const values = {
      quantity: line.quantity,
      discountAllocated: discount,
      lineTotal: line.unitPrice * line.quantity - discount,
    };
    if (line.isNew) {
      await tx.insert(orderItems).values({
        orderId: plan.order.id,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantLabel: line.variantLabel,
        sku: line.sku,
        imageUrl: line.imageUrl,
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
        ...values,
      });
    } else {
      await tx
        .update(orderItems)
        .set(values)
        .where(
          and(eq(orderItems.orderId, plan.order.id), eq(orderItems.variantId, line.variantId)),
        );
    }
  }
}

/**
 * Applies an edit. Errors: `conflict` (version), `invalid` (`orderNotEditable`, address,
 * lines, `shippingRateUnavailable`, `depositNoLongerRequired`, `editNoChange`,
 * `reservationExpired`), `insufficientStock`, `forbidden` (override without Manager rights).
 */
export async function editOrder(
  ctx: CommandContext,
  input: OrderEditInput,
): Promise<CommandResult<OrderEditResult>> {
  assertCan(ctx.actor, 'orders.editBeforeShipping');
  const actor = staffOrderActor(ctx.actor);
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (order.version !== input.expectedVersion) throw new DomainError('conflict');
    assertEditable(order);
    const plan = await planEdit(tx, ctx, order, input);
    if (plan.issues.length > 0) {
      const short = plan.issues.some((issue) => issue.code === 'itemInsufficientStock');
      throw new DomainError(short ? 'insufficientStock' : 'invalid', plan.issues);
    }
    if (!plan.changed) throw new DomainError('invalid', [{ path: 'form', code: 'editNoChange' }]);

    // 1. Stock (inventory module): reservations or committed stock, rows locked by variant id.
    const changes = stockChanges(plan.current, input.items);
    const mode = stockModeFor(plan.status);
    let expiresAt: Date | undefined;
    if (mode === 'reserved' && changes.some((change) => change.delta > 0)) {
      const until = await activeReservationExpiry(tx, order.id);
      if (!until || until.getTime() <= Date.now()) {
        throw new DomainError('invalid', [{ path: 'items', code: 'reservationExpired' }]);
      }
      expiresAt = until;
    }
    try {
      await adjustOrderStock(tx, {
        orderId: order.id,
        mode,
        changes,
        expiresAt,
        actorId: ctx.actor.id,
        note: `order ${order.code} edited`,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'insufficientStock') {
        throw new DomainError('insufficientStock', stockIssues(error, input.items));
      }
      throw error;
    }

    // 2. Coupon redemption (promotion module) follows the new discount or is given back.
    const couponDropped = plan.coupon && !plan.coupon.kept ? plan.coupon.code : null;
    if (plan.moneyChanged && plan.coupon) {
      await syncOrderRedemption(tx, {
        orderId: order.id,
        amount: plan.coupon.kept ? plan.couponAmount : null,
      });
    }

    // 3. The order itself.
    if (plan.lineDiff.length > 0 || plan.moneyChanged) await writeLines(tx, plan);
    if (plan.addressFields.length > 0) {
      const { addressAfter: a } = plan;
      await tx
        .insert(orderAddresses)
        .values({ orderId: order.id, type: 'shipping', ...a })
        .onConflictDoUpdate({
          target: [orderAddresses.orderId, orderAddresses.type],
          set: { ...a, legacyDistrict: null, updatedAt: new Date() },
        });
    }
    await tx
      .update(orders)
      .set({
        ...plan.after,
        couponCode: couponDropped ? null : order.couponCode,
        shippingRateId: plan.shipping.rateId,
        version: sql`${orders.version} + 1`,
      })
      .where(eq(orders.id, order.id));

    const totalsDiff = diffTotals(plan.before, plan.after);
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: ORDER_EDITED_EVENT,
      message: input.note || null,
      actor,
      diff: {
        ...(plan.addressFields.length > 0 ? { address: plan.addressDiff } : {}),
        ...(plan.lineDiff.length > 0 ? { items: plan.lineDiff } : {}),
        ...(Object.keys(totalsDiff).length > 0 ? { totals: totalsDiff } : {}),
        ...(couponDropped ? { coupon: { from: couponDropped, to: null } } : {}),
      },
      metadata: {
        version: order.version + 1,
        stock: mode,
        // Timeline summary (the admin timeline reads metadata only; the full diff is in `diff`).
        summary: {
          total: { from: plan.before.total, to: plan.after.total },
          itemsChanged: plan.lineDiff.length,
          addressChanged: plan.addressFields.length > 0,
        },
        shippingFeeOverride: plan.shipping.override,
        ...(plan.shipping.override !== plan.overrideBefore && input.shippingFeeOverride
          ? { shippingFeeOverrideReason: input.shippingFeeOverride.reason }
          : {}),
        ...(couponDropped && plan.coupon && !plan.coupon.kept
          ? { couponDropped: { code: couponDropped, reason: plan.coupon.reason } }
          : {}),
      },
    });

    // 4. Money (payment module): status, stale sessions, refund of the excess, covered order.
    const settled = await settleOrderAfterEdit(tx, ctx.boss, {
      orderId: order.id,
      actorId: ctx.actor.id,
      totalChanged: plan.after.total !== plan.before.total,
    });

    const [{ version } = { version: order.version + 1 }] = await tx
      .select({ version: orders.version })
      .from(orders)
      .where(eq(orders.id, order.id));

    // Audit: field names and amounts only, never the address values (PII).
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.edit',
      entityType: 'order',
      entityId: order.id,
      diff: {
        version: { from: order.version, to: version },
        ...totalsDiff,
        ...(plan.addressFields.length > 0
          ? { addressFields: { from: null, to: plan.addressFields } }
          : {}),
        ...(plan.lineDiff.length > 0
          ? {
              items: {
                from: plan.lineDiff.map((line) => `${line.sku}×${line.from ?? 0}`),
                to: plan.lineDiff.map((line) => `${line.sku}×${line.to ?? 0}`),
              },
            }
          : {}),
        ...(plan.shipping.override !== plan.overrideBefore
          ? { shippingFeeOverride: { from: plan.overrideBefore, to: plan.shipping.override } }
          : {}),
        ...(couponDropped ? { couponCode: { from: couponDropped, to: null } } : {}),
        ...(settled.refundId ? { refundQueued: { from: null, to: settled.refund } } : {}),
      },
      ip: ctx.ip,
    });

    await enqueue(ctx.boss, tx, 'order.updated', { orderId: order.id, version });
    const touched = new Set(changes.map((change) => change.variantId));
    const productIds = new Set(
      [...plan.current, ...plan.planned]
        .filter((line) => touched.has(line.variantId))
        .map((line) => line.productId),
    );
    const tags = await enqueueRevalidation(ctx.boss, tx, [
      orderTags.list,
      orderTags.order(order.id),
      ...[...touched].map((id) => catalogTags.inventory(id)),
      ...[...productIds].map((id) => catalogTags.product(id)),
    ]);

    return {
      data: {
        orderId: order.id,
        code: order.code,
        version,
        total: plan.after.total,
        onlineDue: settled.onlineDue,
        refund: settled.refund,
        refundId: settled.refundId,
        couponDropped,
      },
      tags,
    };
  });
}

/** Variant picker of the edit page: labels in the order's locale, never decants. */
export async function searchOrderEditVariants(
  ctx: CommandContext,
  input: EditVariantSearchInput,
): Promise<CommandResult<EditVariantOption[]>> {
  assertCan(ctx.actor, 'orders.editBeforeShipping');
  const [order] = await ctx.db
    .select({ locale: orders.locale })
    .from(orders)
    .where(eq(orders.id, input.orderId));
  if (!order) throw new DomainError('notFound');
  return { data: await searchEditVariants(ctx.db, { q: input.q, locale: order.locale }), tags: [] };
}
