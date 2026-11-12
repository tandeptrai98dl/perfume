/**
 * Cloudflare Turnstile adapter (ARCHITECTURE.md §12 Authentication / Abuse): server-side
 * verification of widget tokens through the Siteverify API.
 *
 * Used on sign-up, sign-in, forgot password, guest order lookup and place order — never on
 * webhooks. `createTurnstileVerifier` returns `null` when `TURNSTILE_SECRET_KEY` is unset
 * (development, E2E): callers then skip the check. A token is single-use and valid for 300 s.
 * Network failures fail closed (the form asks to retry); during a Cloudflare outage the
 * runbook switches Turnstile off by unsetting the key.
 */

import { serverEnv } from '@/lib/env';

export { TURNSTILE_ACTIONS, TURNSTILE_TOKEN_HEADER, type TurnstileAction } from '@/lib/turnstile';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare caps tokens at 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult =
  | { success: true; hostname: string | null; action: string | null }
  | { success: false; errorCodes: string[] };

export type TurnstileVerifyInput = {
  token: string | null | undefined;
  /** Trusted client IP (`resolveClientIp`); optional extra signal for Cloudflare. */
  remoteIp?: string | null;
  /** Widget `action` the token must carry (e.g. `sign-in`); unchecked when omitted. */
  expectedAction?: string;
};

export type TurnstileVerifier = {
  verify(input: TurnstileVerifyInput): Promise<TurnstileResult>;
};

export type TurnstileConfig = {
  secretKey?: string | null;
  fetch?: typeof fetch;
  /** Siteverify URL; overridable for tests. */
  verifyUrl?: string;
  timeoutMs?: number;
};

type SiteverifyResponse = {
  success?: boolean;
  'error-codes'?: unknown;
  hostname?: unknown;
  action?: unknown;
};

function failure(...errorCodes: string[]): TurnstileResult {
  return { success: false, errorCodes };
}

export function createTurnstileVerifier(config: TurnstileConfig): TurnstileVerifier | null {
  const { secretKey } = config;
  if (!secretKey) return null;
  // Resolved per call so test doubles (MSW) and instrumentation patches apply.
  const doFetch: typeof fetch = config.fetch ?? ((input, init) => fetch(input, init));
  const url = config.verifyUrl ?? TURNSTILE_VERIFY_URL;
  const timeoutMs = config.timeoutMs ?? 5_000;

  return {
    async verify({ token, remoteIp, expectedAction }) {
      if (!token) return failure('missing-input-response');
      if (token.length > MAX_TOKEN_LENGTH) return failure('invalid-input-response');

      const body = new URLSearchParams({ secret: secretKey, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);

      let payload: SiteverifyResponse;
      try {
        const response = await doFetch(url, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return failure(`http-${response.status}`);
        payload = (await response.json()) as SiteverifyResponse;
      } catch {
        // Never include the request in errors: it carries the secret (ADR-0007).
        return failure('network-error');
      }

      if (payload.success !== true) {
        const codes = Array.isArray(payload['error-codes'])
          ? payload['error-codes'].filter((code): code is string => typeof code === 'string')
          : [];
        return failure(...(codes.length > 0 ? codes : ['unknown']));
      }
      const action = typeof payload.action === 'string' ? payload.action : null;
      if (expectedAction && action !== expectedAction) return failure('action-mismatch');
      return {
        success: true,
        hostname: typeof payload.hostname === 'string' ? payload.hostname : null,
        action,
      };
    },
  };
}

let cached: TurnstileVerifier | null | undefined;

/** Process-wide verifier from `TURNSTILE_SECRET_KEY`; null when Turnstile is off. */
export function getTurnstileVerifier(): TurnstileVerifier | null {
  if (cached === undefined)
    cached = createTurnstileVerifier({ secretKey: serverEnv().TURNSTILE_SECRET_KEY });
  return cached;
}
