import { and, desc, eq, gt, isNotNull, min, or } from 'drizzle-orm';

import { orders, payments, stockReservations } from '@/server/db/schema';
import { GatewayError, type BankAccount } from '@/server/integrations/payments';
import { DomainError, isUniqueViolation, type Tx } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { extendReservations } from '@/server/modules/inventory';
import { lockOrder, recordOrderEvent } from '@/server/modules/order';
import { getCommerceSettings } from '@/server/modules/settings';

import { SYSTEM_ACTOR } from './ledger';
import { nextSessionAmount, sessionKind } from './status';
import { generateTxnRef, transferNote } from './txn-ref';
import type { OnlineProvider, PaymentDeps, PaymentSessionView } from './types';

/*
 * Online payment sessions (ARCHITECTURE.md §3.4 step 3, ADR-0006): one `payments` row per
 * attempt, expiring after `checkout.paymentSessionMinutes`. A still-valid pending session is
 * reused; a retry (method may change) is allowed while the stock reservation is valid, and
 * extends the reservation so it outlives the new session, never beyond
 * `placed_at + reservation window + one session` (no endless stock holding).
 */

/** Sessions closer than this to expiry are not reused (customer needs time to pay). */
const REUSE_MARGIN_MS = 60_000;
/** A new session must give the customer at least this long. */
const MIN_SESSION_MS = 2 * 60_000;

const PAYABLE_STATUSES = ['pending', 'awaiting_confirmation'];

type PaymentRow = typeof payments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

function invalid(code: string): DomainError {
  return new DomainError('invalid', [{ path: 'payment', code }]);
}

export function toSessionView(payment: PaymentRow, orderCode: string): PaymentSessionView {
  const raw = (payment.raw ?? {}) as { account?: BankAccount | null; simulated?: boolean };
  return {
    paymentId: payment.id,
    provider: payment.provider as OnlineProvider,
    kind: payment.kind,
    amount: payment.amount,
    status: payment.status,
    txnRef: payment.txnRef,
    checkoutUrl: payment.checkoutUrl,
    qrCode: payment.qrCode,
    account: raw.account ?? null,
    transferNote: transferNote(orderCode),
    expiresAt: payment.expiresAt,
    simulated: raw.simulated === true,
  };
}

/** Earliest expiry of the order's active reservations (null = none left). */
export async function reservationExpiry(tx: Pick<Tx, 'select'>, orderId: string) {
  const [row] = await tx
    .select({ expiresAt: min(stockReservations.expiresAt) })
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, 'active')));
  return row?.expiresAt ? new Date(row.expiresAt) : null;
}

/** Hard limit for holding stock while the customer retries (see header). */
export function reservationCap(
  order: Pick<OrderRow, 'placedAt' | 'paymentMethod'>,
  settings: { reservationMinutes: number; sessionMinutes: number },
): Date {
  return new Date(
    order.placedAt.getTime() + (settings.reservationMinutes + settings.sessionMinutes) * 60_000,
  );
}

async function insertPayment(
  tx: Tx,
  values: Omit<typeof payments.$inferInsert, 'txnRef'>,
  now: Date,
): Promise<PaymentRow> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Savepoint: a txn_ref clash must not abort the surrounding transaction.
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(payments)
          .values({ ...values, txnRef: generateTxnRef(now) })
          .returning();
        return row!;
      });
    } catch (error) {
      if (attempt < 4 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

export type CreatePaymentSessionInput = {
  orderId: string;
  provider: OnlineProvider;
  /** Customer IP for VNPay; `127.0.0.1` when unknown. */
  ipAddress?: string | null;
  /** Result page URL (built by the caller: localized path + access token). */
  returnUrl: string;
  cancelUrl?: string;
};

/**
 * Creates (or reuses) the online payment session of an order. Errors (`DomainError('invalid')`
 * with field code): `notPayable`, `nothingDue`, `providerUnavailable`, `reservationExpired`,
 * `gatewayError`.
 */
export async function createPaymentSession(
  deps: PaymentDeps,
  input: CreatePaymentSessionInput,
): Promise<PaymentSessionView & { reused: boolean }> {
  const now = deps.now?.() ?? new Date();
  const gateway = deps.gateways[input.provider];
  if (!gateway) throw invalid('providerUnavailable');

  const prepared = await deps.db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!PAYABLE_STATUSES.includes(order.status)) throw invalid('notPayable');
    const amount = nextSessionAmount(order);
    if (amount <= 0) throw invalid('nothingDue');
    const kind = sessionKind(order.paymentMethod);

    const [reusable] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.orderId, order.id),
          eq(payments.status, 'pending'),
          eq(payments.provider, input.provider),
          eq(payments.amount, amount),
          gt(payments.expiresAt, new Date(now.getTime() + REUSE_MARGIN_MS)),
          or(isNotNull(payments.checkoutUrl), isNotNull(payments.qrCode)),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (reusable) return { order, payment: reusable, reused: true };

    const reservedUntil = await reservationExpiry(tx, order.id);
    if (!reservedUntil || reservedUntil.getTime() <= now.getTime()) {
      throw invalid('reservationExpired');
    }
    const settings = await getCommerceSettings(tx);
    const sessionMinutes = settings.checkout.paymentSessionMinutes;
    const cap = reservationCap(order, {
      reservationMinutes:
        order.paymentMethod === 'cod'
          ? settings.cod.confirmationWindowHours * 60
          : settings.checkout.onlineReservationMinutes,
      sessionMinutes,
    });
    const expiresAt = new Date(Math.min(now.getTime() + sessionMinutes * 60_000, cap.getTime()));
    if (expiresAt.getTime() - now.getTime() < MIN_SESSION_MS) throw invalid('reservationExpired');
    if (reservedUntil.getTime() < expiresAt.getTime()) {
      await extendReservations(tx, order.id, expiresAt);
    }

    // One live session per order: an older session paid later still counts (IPN), but the
    // customer is never shown two QR codes at once.
    await tx
      .update(payments)
      .set({ status: 'cancelled' })
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')));

    if (order.paymentMethod !== 'cod' && order.paymentMethod !== input.provider) {
      await tx.update(orders).set({ paymentMethod: input.provider }).where(eq(orders.id, order.id));
    }

    const payment = await insertPayment(
      tx,
      { orderId: order.id, provider: input.provider, kind, amount, expiresAt },
      now,
    );
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: 'payment_session_created',
      actor: SYSTEM_ACTOR,
      metadata: { paymentId: payment.id, provider: input.provider, kind, amount },
    });
    return { order, payment, reused: false };
  });

  if (prepared.reused) {
    return { ...toSessionView(prepared.payment, prepared.order.code), reused: true };
  }

  // Gateway call outside the transaction: no row lock is held during network I/O.
  const { order, payment } = prepared;
  try {
    const session = await gateway.createSession({
      txnRef: payment.txnRef,
      amount: payment.amount,
      orderCode: order.code,
      description: transferNote(order.code),
      locale: order.locale,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl ?? input.returnUrl,
      ipAddress: input.ipAddress || '127.0.0.1',
      createdAt: now,
      expiresAt: payment.expiresAt!,
    });
    const [updated] = await deps.db
      .update(payments)
      .set({
        checkoutUrl: session.checkoutUrl,
        qrCode: session.qrCode,
        providerTxnId: session.providerTxnId,
        raw: {
          ...session.raw,
          account: session.account,
          simulated: gateway.mode === 'simulator',
        },
      })
      .where(eq(payments.id, payment.id))
      .returning();
    return { ...toSessionView(updated!, order.code), reused: false };
  } catch (error) {
    logger.error('payment.session.gateway_failed', {
      provider: input.provider,
      paymentId: payment.id,
      reason: error instanceof GatewayError ? error.reason : undefined,
      ...errorFields(error),
    });
    await deps.db
      .update(payments)
      .set({
        status: 'failed',
        raw: { error: error instanceof GatewayError ? error.reason : 'unexpected' },
      })
      .where(eq(payments.id, payment.id));
    throw invalid('gatewayError');
  }
}
