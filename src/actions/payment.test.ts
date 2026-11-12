import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startPaymentAction } from './payment';

/*
 * §12 rate limiting of the storefront payment start: every call creates a payment attempt
 * and calls the gateway API, so it is limited per IP before any order is looked up.
 * Payment module, order access and the limiter are doubles (no database).
 */

const { guardRequest, findOrderByCode, createPaymentSession } = vi.hoisted(() => ({
  guardRequest: vi.fn(),
  findOrderByCode: vi.fn(),
  createPaymentSession: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/request-guard', () => ({ guardRequest }));
vi.mock('@/server/request-ip', () => ({ getClientIp: async () => '203.0.113.7' }));
vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/server/modules/payment', async () => {
  const { z } = await import('zod');
  return {
    findOrderByCode,
    createPaymentSession,
    onlineProviderSchema: z.enum(['vnpay', 'payos']),
  };
});
vi.mock('@/server/payment-access', () => ({
  canViewOrder: async () => true,
  checkoutResultUrl: () => 'http://localhost/thanh-toan/ket-qua?code=PF-1',
  paymentDeps: async () => ({}),
  pickOrderCode: (code: string) => code,
}));

const input = { code: 'PF-2611-ABCD', token: null, provider: 'payos', locale: 'vi' };

beforeEach(() => {
  vi.clearAllMocks();
  findOrderByCode.mockResolvedValue({ id: 'order-1', code: input.code, userId: null });
  createPaymentSession.mockResolvedValue({ provider: 'payos', checkoutUrl: 'https://pay' });
});

describe('startPaymentAction rate limit', () => {
  it('refuses over the paymentStart limit before touching the order or the gateway', async () => {
    guardRequest.mockResolvedValue({ ok: false, error: 'rateLimited', retryAfterMs: 1000 });
    expect(await startPaymentAction(input)).toEqual({ ok: false, error: 'rateLimited' });
    expect(guardRequest).toHaveBeenCalledWith({ scope: 'paymentStart' });
    expect(findOrderByCode).not.toHaveBeenCalled();
    expect(createPaymentSession).not.toHaveBeenCalled();
  });

  it('starts the payment within the limit', async () => {
    guardRequest.mockResolvedValue({ ok: true, ip: '203.0.113.7' });
    expect(await startPaymentAction(input)).toEqual({
      ok: true,
      provider: 'payos',
      checkoutUrl: 'https://pay',
    });
  });

  it('does not consume the limit for invalid input', async () => {
    expect(await startPaymentAction({ code: 'x' })).toEqual({ ok: false, error: 'validation' });
    expect(guardRequest).not.toHaveBeenCalled();
  });
});
