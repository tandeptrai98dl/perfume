/**
 * Order fulfilment state machine (ARCHITECTURE.md §3.5, ADR-0005). Pure: no I/O.
 * `payment_status` is a separate machine owned by the payment module.
 */

export const ORDER_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type TransitionActor = 'system' | 'customer' | 'staff' | 'manager';

type Rule = { to: OrderStatus; actors: readonly TransitionActor[]; note?: string };

/**
 * Allowed transitions and who may trigger them. `manager` means a staff member with the
 * `orders.cancelPaid` permission (Owner/Manager); callers map permissions to actors.
 */
const RULES: Record<OrderStatus, readonly Rule[]> = {
  pending: [
    { to: 'confirmed', actors: ['system'], note: 'fully paid (or deposit paid for COD)' },
    { to: 'cancelled', actors: ['system', 'customer', 'staff'] },
  ],
  awaiting_confirmation: [
    { to: 'confirmed', actors: ['staff'] },
    { to: 'cancelled', actors: ['system', 'customer', 'staff'] },
  ],
  confirmed: [
    { to: 'processing', actors: ['staff'] },
    // A confirmed order may already hold money: only a manager cancels it (refund follows).
    { to: 'cancelled', actors: ['manager'] },
  ],
  processing: [
    { to: 'shipped', actors: ['staff'] },
    { to: 'cancelled', actors: ['manager'] },
  ],
  shipped: [
    { to: 'delivered', actors: ['staff', 'system'] },
    { to: 'delivery_failed', actors: ['staff', 'system'] },
  ],
  delivery_failed: [{ to: 'returned', actors: ['staff'] }],
  delivered: [
    { to: 'completed', actors: ['system'] },
    { to: 'return_requested', actors: ['customer', 'staff'] },
  ],
  return_requested: [
    { to: 'returned', actors: ['staff'] },
    { to: 'delivered', actors: ['staff'], note: 'return rejected' },
    // ADR-0027: a return a manager reopened on a completed order closes back to `completed`.
    { to: 'completed', actors: ['staff'], note: 'return on a reopened order closed' },
  ],
  // ADR-0027: a manager may open a return past the window (audited override); otherwise final.
  completed: [{ to: 'return_requested', actors: ['manager'], note: 'return window override' }],
  cancelled: [],
  returned: [],
};

/** Managers can do everything staff can. */
function actorMatches(allowed: readonly TransitionActor[], actor: TransitionActor): boolean {
  return allowed.includes(actor) || (actor === 'manager' && allowed.includes('staff'));
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  return RULES[from].some((rule) => rule.to === to && actorMatches(rule.actors, actor));
}

/** Targets reachable from `from` for `actor` (drives the admin's "valid transition buttons"). */
export function nextStatuses(from: OrderStatus, actor: TransitionActor): OrderStatus[] {
  return RULES[from].filter((rule) => actorMatches(rule.actors, actor)).map((rule) => rule.to);
}

export function isTerminal(status: OrderStatus): boolean {
  return RULES[status].length === 0;
}

/**
 * Orders whose fulfilment is over (privacy deletion, reporting): the terminal states plus
 * `completed`, which only a manager's audited return-window override can reopen (ADR-0027).
 */
export const CLOSED_STATUSES: readonly OrderStatus[] = ['completed', 'cancelled', 'returned'];

/** Orders in these states still hold stock reservations (not yet deducted). */
export const RESERVING_STATUSES: readonly OrderStatus[] = ['pending', 'awaiting_confirmation'];

/** Orders whose stock has been deducted (committed) and must be restocked on cancel/return. */
export const DEDUCTED_STATUSES: readonly OrderStatus[] = [
  'confirmed',
  'processing',
  'shipped',
  'delivery_failed',
  'return_requested',
];

/** Customer may cancel before processing starts (§10.5). */
export function customerCanCancel(status: OrderStatus): boolean {
  return canTransition(status, 'cancelled', 'customer');
}
