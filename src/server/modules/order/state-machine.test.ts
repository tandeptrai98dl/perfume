import { describe, expect, it } from 'vitest';

import {
  canTransition,
  customerCanCancel,
  isTerminal,
  nextStatuses,
  ORDER_STATUSES,
} from './state-machine';

describe('order state machine (ARCHITECTURE §3.5)', () => {
  it('follows the documented happy paths', () => {
    expect(canTransition('pending', 'confirmed', 'system')).toBe(true);
    expect(canTransition('awaiting_confirmation', 'confirmed', 'staff')).toBe(true);
    expect(canTransition('confirmed', 'processing', 'staff')).toBe(true);
    expect(canTransition('processing', 'shipped', 'staff')).toBe(true);
    expect(canTransition('shipped', 'delivered', 'staff')).toBe(true);
    expect(canTransition('delivered', 'completed', 'system')).toBe(true);
    expect(canTransition('delivery_failed', 'returned', 'staff')).toBe(true);
    expect(canTransition('return_requested', 'delivered', 'staff')).toBe(true);
  });

  it('only lets the system confirm online orders (payment arrives by IPN)', () => {
    expect(canTransition('pending', 'confirmed', 'staff')).toBe(false);
    expect(canTransition('pending', 'confirmed', 'manager')).toBe(false);
  });

  it('requires a manager to cancel a confirmed or processing order', () => {
    expect(canTransition('confirmed', 'cancelled', 'staff')).toBe(false);
    expect(canTransition('confirmed', 'cancelled', 'manager')).toBe(true);
    expect(canTransition('processing', 'cancelled', 'manager')).toBe(true);
    expect(canTransition('shipped', 'cancelled', 'manager')).toBe(false);
  });

  it('lets customers cancel only before processing', () => {
    expect(customerCanCancel('pending')).toBe(true);
    expect(customerCanCancel('awaiting_confirmation')).toBe(true);
    expect(customerCanCancel('confirmed')).toBe(false);
  });

  it('has terminal states with no exits', () => {
    for (const status of ['completed', 'cancelled', 'returned'] as const) {
      expect(isTerminal(status)).toBe(true);
      for (const to of ORDER_STATUSES) expect(canTransition(status, to, 'manager')).toBe(false);
    }
  });

  it('lists the buttons a role may press', () => {
    expect(nextStatuses('processing', 'staff')).toEqual(['shipped']);
    expect(nextStatuses('processing', 'manager')).toEqual(['shipped', 'cancelled']);
  });
});
