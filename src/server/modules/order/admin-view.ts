import type { Actor } from '@/server/lib/command-context';
import { hasPermission, type Permission } from '@/server/auth/permissions';

import { nextStatuses, type OrderStatus } from './state-machine';
import type { OrderActor } from './transition';

/*
 * Pure admin helpers for orders (no I/O): RBAC → state-machine actor, contact masking,
 * money figures shown on the detail page and the printed slips. Unit-tested.
 */

/** Staff with `orders.cancelPaid` (Owner/Manager) act as `manager` in the state machine. */
export function staffOrderActor(actor: Actor): OrderActor {
  return {
    type: 'staff',
    id: actor.id,
    isManager: hasPermission(actor.role, 'orders.cancelPaid'),
  };
}

/** Valid transition buttons for this staff member (§11.2 "only valid transition buttons"). */
export function staffNextStatuses(status: OrderStatus, role: string): OrderStatus[] {
  if (!hasPermission(role, 'orders.process')) return [];
  return nextStatuses(status, hasPermission(role, 'orders.cancelPaid') ? 'manager' : 'staff');
}

/** RBAC §11.1: contact details need `customers.view` or `customers.viewContactInOrder`. */
export function canViewContact(role: string): boolean {
  const permissions: Permission[] = ['customers.view', 'customers.viewContactInOrder'];
  return permissions.some((permission) => hasPermission(role, permission));
}

/** `0912345678` → `091****678` (enough to match a caller, not to reuse the number). */
export function partialPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 6)}${digits.slice(-3)}`;
}

/** `khach.hang@example.com` → `k***@example.com`. */
export function partialEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export type ContactView = { phone: string; email: string; masked: boolean };

export function contactView(contact: { phone: string; email: string }, role: string): ContactView {
  if (canViewContact(role)) return { phone: contact.phone, email: contact.email, masked: false };
  return { phone: partialPhone(contact.phone), email: partialEmail(contact.email), masked: true };
}

type Money = {
  status: OrderStatus;
  paymentMethod: string;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountRefunded: number;
};

/** A COD order above the threshold may be confirmed only once its deposit is paid (D16). */
export function depositSatisfied(order: Pick<Money, 'depositRequired' | 'amountPaid'>): boolean {
  return order.depositRequired <= 0 || order.amountPaid >= order.depositRequired;
}

export type OrderMoneySummary = {
  amountDue: number;
  depositRequired: number;
  depositOutstanding: number;
  /** What the carrier collects on delivery (COD only). */
  codToCollect: number;
  /** Money the shop owes back on a cancelled order (shown; the refund queue creates it). */
  refundOwed: number;
};

export function orderMoneySummary(order: Money): OrderMoneySummary {
  const amountDue = Math.max(order.total - order.amountPaid, 0);
  return {
    amountDue,
    depositRequired: order.depositRequired,
    depositOutstanding: Math.max(order.depositRequired - order.amountPaid, 0),
    codToCollect: order.paymentMethod === 'cod' && order.status !== 'cancelled' ? amountDue : 0,
    refundOwed:
      order.status === 'cancelled' ? Math.max(order.amountPaid - order.amountRefunded, 0) : 0,
  };
}

export type PrintLine = {
  sku: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type PackingSlipTotals = {
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
};

/**
 * Packing slip content (§11.2): gift orders with "hide prices" show no price at all — neither
 * per line nor in totals — so the slip can travel inside a gift box.
 */
export function packingSlipView(
  order: PackingSlipTotals & { hidePrices: boolean },
  items: {
    sku: string;
    productName: string;
    variantLabel: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[],
): { showPrices: boolean; lines: PrintLine[]; totals: PackingSlipTotals | null; units: number } {
  const showPrices = !order.hidePrices;
  return {
    showPrices,
    units: items.reduce((sum, item) => sum + item.quantity, 0),
    lines: items.map((item) => ({
      sku: item.sku,
      productName: item.productName,
      variantLabel: item.variantLabel,
      quantity: item.quantity,
      unitPrice: showPrices ? item.unitPrice : null,
      lineTotal: showPrices ? item.lineTotal : null,
    })),
    totals: showPrices
      ? {
          subtotal: order.subtotal,
          discountTotal: order.discountTotal,
          shippingFee: order.shippingFee,
          giftWrapFee: order.giftWrapFee,
          total: order.total,
        }
      : null,
  };
}
