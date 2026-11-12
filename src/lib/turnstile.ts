/**
 * Cloudflare Turnstile constants shared by the widget (browser) and the server verifier
 * (`src/server/integrations/turnstile`). No secrets here.
 */

/** Explicit rendering: the widget component calls `turnstile.render` itself. */
export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Request header the browser sends the token in (Better Auth endpoints). */
export const TURNSTILE_TOKEN_HEADER = 'x-turnstile-token';

/** Widget actions (≤ 32 chars, `[a-z0-9_-]`), checked against the verified token. */
export const TURNSTILE_ACTIONS = {
  signUp: 'sign-up',
  signIn: 'sign-in',
  forgotPassword: 'forgot-password',
  orderLookup: 'order-lookup',
  placeOrder: 'place-order',
  // M3 wave 2: newsletter sign-up (footer, home).
  newsletter: 'newsletter',
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
