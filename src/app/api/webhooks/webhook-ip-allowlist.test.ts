import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Route-level check of the gateway IP allowlist (§12): a call from outside the list is
 * refused with 403 before anything is parsed or stored; a listed source reaches the payment
 * module. The payment module and the job producer are doubles (no database).
 */

const processGatewayNotification = vi.fn(async () => ({ outcome: 'processed' as const }));

vi.mock('@/server/modules/payment', () => ({ processGatewayNotification }));
vi.mock('@/server/jobs/producer', () => ({ getProducer: async () => ({}) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}));

async function loadRoutes() {
  vi.resetModules();
  const vnpay = await import('./vnpay/route');
  const payos = await import('./payos/route');
  return { vnpay, payos };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('TRUSTED_IP_HEADER', 'cf-connecting-ip');
  vi.stubEnv('PAYMENT_SIMULATOR', 'true');
  processGatewayNotification.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function vnpayRequest(ip: string | null) {
  return new NextRequest('http://localhost/api/webhooks/vnpay?vnp_TxnRef=1&vnp_Amount=100', {
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  });
}

function payosRequest(ip: string | null) {
  return new Request('http://localhost/api/webhooks/payos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: JSON.stringify({ code: '00', data: { orderCode: 1 }, signature: 'x' }),
  });
}

describe('webhook IP allowlist', () => {
  it('is off when unset: any source reaches the payment module', async () => {
    const { vnpay, payos } = await loadRoutes();
    expect((await vnpay.GET(vnpayRequest('198.51.100.1'))).status).toBe(200);
    expect((await payos.POST(payosRequest(null))).status).toBe(200);
    expect(processGatewayNotification).toHaveBeenCalledTimes(2);
  });

  it('refuses VNPay IPNs from outside VNPAY_IPN_ALLOWED_IPS with 403', async () => {
    vi.stubEnv('VNPAY_IPN_ALLOWED_IPS', '113.160.92.202');
    const { vnpay } = await loadRoutes();
    const blocked = await vnpay.GET(vnpayRequest('198.51.100.1'));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ RspCode: '99', Message: 'Forbidden' });
    // A forged x-forwarded-for does not help: only TRUSTED_IP_HEADER is read.
    const spoofed = new NextRequest('http://localhost/api/webhooks/vnpay?vnp_TxnRef=1', {
      headers: { 'x-forwarded-for': '113.160.92.202' },
    });
    expect((await vnpay.GET(spoofed)).status).toBe(403);
    expect(processGatewayNotification).not.toHaveBeenCalled();

    expect((await vnpay.GET(vnpayRequest('113.160.92.202'))).status).toBe(200);
    expect(processGatewayNotification).toHaveBeenCalledTimes(1);
  });

  it('refuses payOS webhooks from outside PAYOS_WEBHOOK_ALLOWED_IPS with 403', async () => {
    vi.stubEnv('PAYOS_WEBHOOK_ALLOWED_IPS', '203.0.113.0/24');
    const { payos } = await loadRoutes();
    expect((await payos.POST(payosRequest('198.51.100.1'))).status).toBe(403);
    expect((await payos.POST(payosRequest(null))).status).toBe(403);
    expect(processGatewayNotification).not.toHaveBeenCalled();
    expect((await payos.POST(payosRequest('203.0.113.50'))).status).toBe(200);
    expect(processGatewayNotification).toHaveBeenCalledTimes(1);
  });
});

describe('webhook body limit', () => {
  it('refuses a streamed payOS body over 64 KB without processing it', async () => {
    const { payos } = await loadRoutes();
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 64) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new Request('http://localhost/api/webhooks/payos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect((await payos.POST(request)).status).toBe(413);
    // Reading stopped right after the limit (not the whole 1 MB).
    expect(sent).toBeLessThan(10);
    expect(processGatewayNotification).not.toHaveBeenCalled();
  });
});
