import { eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orders } from '@/server/db/schema';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  isUniqueViolation,
  type CommandContext,
  type CommandResult,
  type FieldIssue,
} from '@/server/lib/command-context';
import { resolveCustomerRef } from '@/server/modules/customer';
import {
  orderTags,
  recordOrderEvent,
  staffOrderActor,
  transitionInTx,
  type OrderStatus,
} from '@/server/modules/order';
import { recordManualBankTransfer } from '@/server/modules/payment';

import { evaluateCheckout, type CouponIssueCode } from './evaluate';
import {
  manualFollowUp,
  manualPaymentMethod,
  mergeManualContact,
  type ManualOrderInput,
  type ManualQuoteInput,
  type PaymentLinkProvider,
} from './manual-order-schemas';
import { findOrderByCheckoutKey, placeOrderInTx, type PlacedOrder } from './place-order';

/*
 * Manual orders (§3.4 step 7, §11.2 `/admin/orders/new`, ADR-0009): staff enter an order for a
 * phone/Zalo customer. One transaction: resolve the customer → `placeOrderInTx` with
 * `source = 'admin'` (same pricing, coupon, shipping and stock reservation as the storefront)
 * → `created_by_staff` event (+ staff note) → follow-up chosen on the form:
 *   - COD confirmed on the phone → `confirmed` through `transitionInTx` (deposit rule kept);
 *   - bank transfer already received → the payment module records it (Manager/Owner only),
 *     which confirms the order;
 *   - payment link → the caller opens a payment session after commit (gateway I/O never runs
 *     inside the transaction) and hands out the result-page link.
 * Audit row + cache tags; the `order.placed` job sends the e-mail in the chosen language.
 */

export type ManualOrderResult = {
  orderId: string;
  code: string;
  status: OrderStatus;
  paymentMethod: PlacedOrder['paymentMethod'];
  total: number;
  depositRequired: number;
  locale: 'vi' | 'en';
  /** Provider of the payment session the caller must open (null = none needed). */
  paymentLink: PaymentLinkProvider | null;
  duplicate: boolean;
};

function invalid(issues: FieldIssue[]): never {
  throw new DomainError('invalid', issues);
}

async function currentStatus(db: Pick<Database, 'select'>, orderId: string): Promise<OrderStatus> {
  const [row] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row!.status;
}

async function duplicateResult(
  db: Pick<Database, 'select'>,
  placed: PlacedOrder,
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
  const status = await currentStatus(db, placed.orderId);
  const online = placed.paymentMethod === 'payos' || placed.paymentMethod === 'vnpay';
  const depositLink = placed.paymentMethod === 'cod' && placed.depositRequired > 0;
  return {
    ...placed,
    status,
    paymentLink:
      status === 'pending' && (online || depositLink)
        ? online
          ? (placed.paymentMethod as PaymentLinkProvider)
          : input.linkProvider
        : null,
    duplicate: true,
  };
}

export async function placeManualOrder(
  ctx: CommandContext,
  input: ManualOrderInput,
): Promise<CommandResult<ManualOrderResult>> {
  assertCan(ctx.actor, 'orders.createManual');
  const transferReceived = input.paymentOption === 'bank_transfer' && input.transfer.received;
  // RBAC §11.1: only Owner/Manager confirm bank transfers; checked before any write.
  if (transferReceived) assertCan(ctx.actor, 'payments.confirmBankTransfer');
  const paymentMethod = manualPaymentMethod(input.paymentOption, input.linkProvider);

  try {
    return await ctx.db.transaction(async (tx) => {
      const match = input.customer.ref ? await resolveCustomerRef(tx, input.customer.ref) : null;
      if (input.customer.ref && !match) invalid([{ path: 'customer.ref', code: 'notFound' }]);
      const merged = mergeManualContact(input.customer, match);
      if (!merged.ok) invalid([{ path: `customer.${merged.field}`, code: 'required' }]);
      const { contact } = merged;

      const placed = await placeOrderInTx(
        tx,
        { boss: ctx.boss },
        {
          source: 'admin',
          staffId: ctx.actor.id,
          checkoutKey: input.checkoutKey,
          items: input.items,
          locale: contact.locale,
          userId: contact.userId,
          email: contact.email,
          phone: contact.phone,
          fullName: contact.fullName,
          address: input.address,
          shippingRateId: input.shippingRateId,
          paymentMethod,
          couponCode: input.couponCode,
          internalNote: input.staffNote,
        },
      );
      if (placed.duplicate) {
        return { data: await duplicateResult(tx, placed, input), tags: [] };
      }

      const followUp = manualFollowUp({
        option: input.paymentOption,
        provider: input.linkProvider,
        depositRequired: placed.depositRequired,
        confirmNow: input.confirmNow,
        transferReceived,
      });
      const actor = staffOrderActor(ctx.actor);
      await recordOrderEvent(tx, {
        orderId: placed.orderId,
        type: 'created_by_staff',
        actor,
        metadata: {
          paymentOption: input.paymentOption,
          paymentMethod,
          linkProvider: followUp.paymentLink,
          confirmNow: followUp.confirm,
          transferReceived: followUp.recordTransfer,
          registeredCustomer: contact.userId !== null,
          emailProvided: contact.email !== '',
        },
      });
      if (input.staffNote) {
        await recordOrderEvent(tx, {
          orderId: placed.orderId,
          type: 'note',
          message: input.staffNote,
          actor,
        });
      }

      if (followUp.confirm) {
        assertCan(ctx.actor, 'orders.process');
        await transitionInTx(ctx, tx, {
          orderId: placed.orderId,
          to: 'confirmed',
          reason: 'confirmed_by_phone',
        });
      }
      if (followUp.recordTransfer) {
        await recordManualBankTransfer(ctx, tx, {
          orderId: placed.orderId,
          amount: placed.total,
          bankReference: input.transfer.bankReference,
          note: null,
        });
      }

      // No PII in the audit diff: contact fields are summarized as flags.
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: 'order.create_manual',
        entityType: 'order',
        entityId: placed.orderId,
        diff: {
          code: { from: null, to: placed.code },
          source: { from: null, to: 'admin' },
          paymentMethod: { from: null, to: paymentMethod },
          total: { from: null, to: placed.total },
          depositRequired: { from: null, to: placed.depositRequired },
          lines: { from: null, to: input.items.length },
          couponCode: { from: null, to: input.couponCode },
          registeredCustomer: { from: null, to: contact.userId !== null },
          locale: { from: null, to: contact.locale },
        },
        ip: ctx.ip,
      });
      const tags = await enqueueRevalidation(ctx.boss, tx, [
        orderTags.list,
        orderTags.order(placed.orderId),
      ]);
      return {
        data: {
          orderId: placed.orderId,
          code: placed.code,
          status: await currentStatus(tx, placed.orderId),
          paymentMethod,
          total: placed.total,
          depositRequired: placed.depositRequired,
          locale: placed.locale,
          paymentLink: followUp.paymentLink,
          duplicate: false,
        },
        tags,
      };
    });
  } catch (error) {
    // A concurrent double submit that lost the race on the unique checkout key.
    if (isUniqueViolation(error, 'orders_checkoutKey_unique')) {
      const existing = await findOrderByCheckoutKey(ctx.db, input.checkoutKey);
      if (existing) return { data: await duplicateResult(ctx.db, existing, input), tags: [] };
    }
    throw error;
  }
}

// ---------- Live summary ----------

export type ManualQuoteLine = {
  variantId: string;
  productName: string;
  brandName: string;
  variantLabel: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  lineTotal: number;
  available: number;
  issue: string | null;
};

export type ManualOrderQuote = {
  lines: ManualQuoteLine[];
  shippingOptions: {
    rateId: string;
    name: string;
    fee: number;
    freeOverSubtotal: number | null;
    etaMinDays: number;
    etaMaxDays: number;
  }[];
  shippingRateId: string | null;
  coupon: { code: string; applied: boolean; issue: CouponIssueCode | null } | null;
  totals: {
    subtotal: number;
    discountTotal: number;
    shippingFee: number | null;
    shippingDiscount: number;
    total: number;
    depositRequired: number;
  };
  cod: { maxOrderWithoutDeposit: number; depositPercent: number };
};

/** Summary beside the form, priced exactly like `placeManualOrder` will price it. */
export async function quoteManualOrder(
  db: Pick<Database, 'select' | 'execute'>,
  input: ManualQuoteInput,
): Promise<ManualOrderQuote> {
  const match = input.customer.ref ? await resolveCustomerRef(db, input.customer.ref) : null;
  const evaluation = await evaluateCheckout(db, {
    items: input.items,
    locale: 'vi',
    provinceCode: input.provinceCode || null,
    shippingRateId: input.shippingRateId || null,
    paymentMethod: input.paymentOption
      ? manualPaymentMethod(input.paymentOption, input.linkProvider)
      : null,
    couponCode: input.couponCode || null,
    customer: {
      phone: input.customer.phone || match?.phone || undefined,
      email: input.customer.email || match?.email || undefined,
      userId: match?.userId ?? null,
    },
    defaultRate: true,
  });
  const { pricing } = evaluation;
  const issues = new Map(
    evaluation.lineIssues.map((issue) => [issue.path.replace(/^items\./, ''), issue.code]),
  );
  const code = input.couponCode.trim();
  return {
    lines: evaluation.lines.map((line) => {
      const discount = pricing.lineDiscounts[line.variantId] ?? 0;
      return {
        variantId: line.variantId,
        productName: line.productName,
        brandName: line.brandName,
        variantLabel: line.variantLabel,
        sku: line.sku,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discount,
        lineTotal: line.unitPrice * line.quantity - discount,
        available: line.available,
        issue: issues.get(line.variantId) ?? null,
      };
    }),
    shippingOptions: evaluation.quotes.map((quote) => ({ ...quote })),
    shippingRateId: evaluation.rate?.rateId ?? null,
    coupon: code
      ? {
          code: evaluation.coupon?.code ?? code,
          applied: !!evaluation.coupon,
          issue: evaluation.couponIssue,
        }
      : null,
    totals: {
      subtotal: pricing.subtotal,
      discountTotal: pricing.discountTotal,
      shippingFee: pricing.shippingFee,
      shippingDiscount: pricing.shippingDiscount,
      total: pricing.total,
      depositRequired: pricing.depositRequired,
    },
    cod: {
      maxOrderWithoutDeposit: evaluation.settings.cod.maxOrderWithoutDeposit,
      depositPercent: evaluation.settings.cod.depositPercent,
    },
  };
}
