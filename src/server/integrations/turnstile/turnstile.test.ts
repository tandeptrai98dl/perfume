import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTurnstileVerifier, TURNSTILE_VERIFY_URL } from '.';

const SECRET = 'test-turnstile-secret';
const received: URLSearchParams[] = [];

/** Siteverify double: token `ok-<action>` passes with that action, anything else fails. */
const server = setupServer(
  http.post(TURNSTILE_VERIFY_URL, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    received.push(form);
    if (form.get('secret') !== SECRET) {
      return HttpResponse.json({ success: false, 'error-codes': ['invalid-input-secret'] });
    }
    const token = form.get('response') ?? '';
    if (token === 'boom') return new HttpResponse(null, { status: 500 });
    if (token.startsWith('ok-')) {
      return HttpResponse.json({
        success: true,
        hostname: 'shop.example.vn',
        action: token.slice(3),
        challenge_ts: new Date().toISOString(),
      });
    }
    return HttpResponse.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  received.length = 0;
});
afterAll(() => server.close());

describe('createTurnstileVerifier', () => {
  it('is disabled without a secret key', () => {
    expect(createTurnstileVerifier({})).toBeNull();
    expect(createTurnstileVerifier({ secretKey: '' })).toBeNull();
  });

  const verifier = createTurnstileVerifier({ secretKey: SECRET })!;

  it('accepts a valid token and sends secret, token and the trusted client IP', async () => {
    const result = await verifier.verify({
      token: 'ok-sign-in',
      remoteIp: '203.0.113.7',
      expectedAction: 'sign-in',
    });
    expect(result).toEqual({ success: true, hostname: 'shop.example.vn', action: 'sign-in' });
    expect(received[0]?.get('secret')).toBe(SECRET);
    expect(received[0]?.get('response')).toBe('ok-sign-in');
    expect(received[0]?.get('remoteip')).toBe('203.0.113.7');
  });

  it('rejects a token issued for another action', async () => {
    expect(await verifier.verify({ token: 'ok-sign-up', expectedAction: 'sign-in' })).toEqual({
      success: false,
      errorCodes: ['action-mismatch'],
    });
  });

  it('passes Cloudflare error codes through (expired or replayed token)', async () => {
    expect(await verifier.verify({ token: 'used-token' })).toEqual({
      success: false,
      errorCodes: ['timeout-or-duplicate'],
    });
  });

  it('fails without calling Cloudflare when the token is missing or oversized', async () => {
    expect(await verifier.verify({ token: '' })).toEqual({
      success: false,
      errorCodes: ['missing-input-response'],
    });
    expect(await verifier.verify({ token: 'x'.repeat(2049) })).toEqual({
      success: false,
      errorCodes: ['invalid-input-response'],
    });
    expect(received).toHaveLength(0);
  });

  it('fails closed on HTTP and network errors', async () => {
    expect(await verifier.verify({ token: 'boom' })).toEqual({
      success: false,
      errorCodes: ['http-500'],
    });
    server.use(http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.error()));
    expect(await verifier.verify({ token: 'ok-sign-in' })).toEqual({
      success: false,
      errorCodes: ['network-error'],
    });
  });

  it('reports a wrong secret as a failure', async () => {
    const wrong = createTurnstileVerifier({ secretKey: 'other' })!;
    expect(await wrong.verify({ token: 'ok-sign-in' })).toEqual({
      success: false,
      errorCodes: ['invalid-input-secret'],
    });
  });
});
