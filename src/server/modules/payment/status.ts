/**
 * Payment money math (ARCHITECTURE.md §3.5 `payment_status`, ADR-0005, ADR-0016). Pure and
 * integer-only (whole VND).
 */

export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type OrderMoney = {
  total: number;
  amountPaid: number;
  amountRefunded: number;
};

/**
 * `unpaid → partially_paid → paid → partially_refunded | refunded`. Refunds dominate: once any
 * money went back the status says so; everything paid back = `refunded`.
 */
export function computePaymentStatus({
  total,
  amountPaid,
  amountRefunded,
}: OrderMoney): PaymentStatus {
  if (amountRefunded > 0) return amountRefunded >= amountPaid ? 'refunded' : 'partially_refunded';
  if (amountPaid <= 0) return 'unpaid';
  return amountPaid >= total ? 'paid' : 'partially_paid';
}

export type PaymentRequirementInput = {
  paymentMethod: string;
  total: number;
  depositRequired: number;
};

/**
 * Money that must arrive online before the order can be confirmed: the whole total for
 * online/bank-transfer orders, the deposit for COD above the threshold (ADR-0016), nothing
 * for COD at or below the threshold.
 */
export function requiredOnlineAmount(order: PaymentRequirementInput): number {
  if (order.paymentMethod === 'cod') return order.depositRequired;
  return order.total;
}

/** The online requirement is met (confirm the order). */
export function isRequirementCovered(order: PaymentRequirementInput & { amountPaid: number }) {
  const required = requiredOnlineAmount(order);
  return required > 0 && order.amountPaid >= required;
}

/** Amount of the next online session, or 0 when nothing more is due online. */
export function nextSessionAmount(order: PaymentRequirementInput & { amountPaid: number }): number {
  return Math.max(0, requiredOnlineAmount(order) - order.amountPaid);
}

export function sessionKind(paymentMethod: string): 'full' | 'deposit' {
  return paymentMethod === 'cod' ? 'deposit' : 'full';
}

/**
 * Money still refundable: paid minus refunded minus refunds already queued. Never negative.
 */
export function refundableAmount(
  order: Pick<OrderMoney, 'amountPaid' | 'amountRefunded'>,
  openRefunds: number,
): number {
  return Math.max(0, order.amountPaid - order.amountRefunded - openRefunds);
}

/** Money received beyond the order total (double payment, payment after a reduction). */
export function overpayment(order: Pick<OrderMoney, 'total' | 'amountPaid'>): number {
  return Math.max(0, order.amountPaid - order.total);
}

/** Remittance check: Σ order amounts − carrier fee vs. the amount on the bank receipt. */
export function remittanceDifference(input: {
  orderAmounts: readonly number[];
  carrierFee: number;
  totalAmount: number;
}): { expected: number; difference: number } {
  const collected = input.orderAmounts.reduce((sum, amount) => sum + amount, 0);
  const expected = collected - input.carrierFee;
  return { expected, difference: input.totalAmount - expected };
}
