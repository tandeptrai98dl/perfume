import type { CheckoutResult } from '@/server/modules/payment';

/** What the checkout result page tells the customer (one message + at most one panel). */
export type ResultState =
  | 'paid'
  | 'depositPaid'
  | 'codConfirm'
  | 'codDepositReceived'
  | 'awaitingPayment'
  | 'depositRequired'
  | 'sessionExpired'
  | 'windowClosed'
  | 'cancelled'
  | 'other';

export type ResultPanel = 'qr' | 'vnpay' | 'start' | 'retry' | null;

type Input = Pick<
  CheckoutResult,
  | 'status'
  | 'paymentStatus'
  | 'paymentMethod'
  | 'onlineDue'
  | 'amountPaid'
  | 'reservedUntil'
  | 'sessionUsable'
  | 'attempts'
> & { session: { provider: string; qrCode: string | null; checkoutUrl: string | null } | null };

const AWAITING = ['pending', 'awaiting_confirmation'];

/** Pure decision table for the result page (unit-tested). */
export function resultView(result: Input, now: Date): { state: ResultState; panel: ResultPanel } {
  if (result.status === 'cancelled') return { state: 'cancelled', panel: null };
  const cod = result.paymentMethod === 'cod';

  if (AWAITING.includes(result.status) && result.onlineDue > 0) {
    const held = !!result.reservedUntil && result.reservedUntil.getTime() > now.getTime();
    if (!held) return { state: 'windowClosed', panel: null };
    const waiting = cod ? 'depositRequired' : 'awaitingPayment';
    if (result.sessionUsable && result.session) {
      if (result.session.provider === 'payos' && result.session.qrCode)
        return { state: waiting, panel: 'qr' };
      if (result.session.provider === 'vnpay' && result.session.checkoutUrl) {
        return { state: waiting, panel: 'vnpay' };
      }
    }
    return result.attempts > 0
      ? { state: 'sessionExpired', panel: 'retry' }
      : { state: waiting, panel: 'start' };
  }

  if (result.status === 'awaiting_confirmation' && cod) {
    return { state: result.amountPaid > 0 ? 'codDepositReceived' : 'codConfirm', panel: null };
  }
  if (result.paymentStatus === 'paid') return { state: 'paid', panel: null };
  if (result.paymentStatus === 'partially_paid') return { state: 'depositPaid', panel: null };
  return { state: 'other', panel: null };
}
