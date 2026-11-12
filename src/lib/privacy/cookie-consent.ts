/**
 * Cookie consent state shared by the banner, the tag loader and the server (PDPL 91/2025,
 * Decree 356/2025: consent must be specific, recorded and as easy to withdraw as to give).
 *
 * The choice lives in a first-party cookie readable by the browser (the tag loader must know
 * it before loading Google Tag Manager) and every choice is also appended to `consents`.
 * Pure functions only: imported by client components, Server Actions and tests.
 */

export const COOKIE_CONSENT_NAME = 'cookie_consent';

/**
 * Version of the cookie notice the visitor answered. Bump it when the categories or the
 * cookie policy change materially: older choices are then asked again.
 */
export const COOKIE_CONSENT_VERSION = '2026-11-01';

/** About six months; the banner asks again afterwards. */
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** Optional categories. "Necessary" cookies (cart, session, language, this choice) are always on. */
export const OPTIONAL_COOKIE_CATEGORIES = ['analytics', 'ads'] as const;
export type CookieCategory = (typeof OPTIONAL_COOKIE_CATEGORIES)[number];

export type CookieChoice = { analytics: boolean; ads: boolean };

export type CookieConsent = CookieChoice & {
  version: string;
  /** Epoch seconds of the choice. */
  decidedAt: number;
  /** Id of the first `consents` row written for this choice (proof of consent). */
  receiptId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serializeCookieConsent(consent: CookieConsent): string {
  const params = new URLSearchParams({
    v: consent.version,
    a: consent.analytics ? '1' : '0',
    d: consent.ads ? '1' : '0',
    t: String(consent.decidedAt),
  });
  if (consent.receiptId) params.set('id', consent.receiptId);
  return params.toString();
}

/** Parses the cookie value; anything malformed counts as "not answered". */
export function parseCookieConsent(value: string | null | undefined): CookieConsent | null {
  if (!value) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(value);
  } catch {
    return null;
  }
  const version = params.get('v');
  const analytics = params.get('a');
  const ads = params.get('d');
  const decidedAt = Number(params.get('t'));
  const receiptId = params.get('id');
  if (!version || version.length > 32) return null;
  if (!['0', '1'].includes(analytics ?? '') || !['0', '1'].includes(ads ?? '')) return null;
  if (!Number.isSafeInteger(decidedAt) || decidedAt <= 0) return null;
  return {
    version,
    analytics: analytics === '1',
    ads: ads === '1',
    decidedAt,
    receiptId: receiptId && UUID.test(receiptId) ? receiptId : null,
  };
}

/** A stored choice is valid only for the current notice version. */
export function isCurrentConsent(consent: CookieConsent | null): consent is CookieConsent {
  return !!consent && consent.version === COOKIE_CONSENT_VERSION;
}

/** Reads the consent cookie from a `document.cookie` / `Cookie` header string. */
export function readCookieConsent(cookieHeader: string | null | undefined): CookieConsent | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== COOKIE_CONSENT_NAME) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return parseCookieConsent(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
}

/** Set on <html> before first paint when the visitor already answered the current notice. */
export const COOKIE_CONSENT_ANSWERED_ATTRIBUTE = 'data-cookie-consent';

/**
 * Inline script for <head>: the cookie banner is part of the static page shell, so it paints
 * with the first frame for new visitors (it is often the LCP element, §14.1); this marks
 * <html> before that first paint when the stored choice matches the current notice version,
 * and `globals.css` then hides the banner, so returning visitors never see it flash. After
 * hydration the banner component decides from `readCookieConsent` and removes the attribute.
 * Plain ES5, no dependencies; a malformed cookie simply leaves the banner visible.
 */
export function cookieConsentPaintScript(): string {
  const name = JSON.stringify(`${COOKIE_CONSENT_NAME}=`);
  const version = JSON.stringify(COOKIE_CONSENT_VERSION);
  const attribute = JSON.stringify(COOKIE_CONSENT_ANSWERED_ATTRIBUTE);
  return (
    `(function(){try{var c=document.cookie.split(';');for(var i=0;i<c.length;i++){` +
    `var p=c[i].replace(/^\\s+/,'');if(p.indexOf(${name})!==0)continue;` +
    `var v=new URLSearchParams(decodeURIComponent(p.slice(${name}.length))).get('v');` +
    `if(v===${version})document.documentElement.setAttribute(${attribute},'answered');}}catch(e){}})();`
  );
}

/**
 * Google Consent Mode v2 state for a choice. Defaults are all denied; GTM is only loaded
 * once something optional is granted, and the update below is pushed before its first event.
 */
export function consentModeState(choice: CookieChoice | null) {
  const analytics = choice?.analytics ? 'granted' : 'denied';
  const ads = choice?.ads ? 'granted' : 'denied';
  return {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: analytics,
  } as const;
}

export const CONSENT_MODE_DEFAULTS = {
  ...consentModeState(null),
  functionality_storage: 'granted',
  security_storage: 'granted',
  wait_for_update: 500,
} as const;

/** Third-party cookies set by GA4 / Meta Pixel, removed on withdrawal. */
export function trackingCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter((name) => /^(_ga(_.+)?|_gid|_gat(_.+)?|_gcl_.+|_fbp|_fbc)$/.test(name));
}

/**
 * Masks an IP for anonymous cookie choices (data minimisation): IPv4 keeps /24, IPv6 keeps /48.
 * Returns null for anything that is not an IP.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1, 4).map(Number);
    if (octets.some((n) => n > 255) || Number(v4[4]) > 255) return null;
    return `${octets.join('.')}.0`;
  }
  if (ip.includes(':') && /^[0-9a-f:]+$/i.test(ip)) {
    const [head = '', tail] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail !== undefined && tail ? tail.split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0 || (tail === undefined && left.length !== 8)) return null;
    const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill('0'), ...right];
    return `${groups.slice(0, 3).join(':')}::`;
  }
  return null;
}

/** Query parameters of signed links (order access, newsletter, privacy, password reset). */
const SECRET_QUERY_PARAMS = ['t', 'token', 's'] as const;
/** Review invitation links carry their token in the path (`/danh-gia/<token>`, `/en/review/…`). */
const SECRET_PATH = /^(?:\/en)?\/(?:danh-gia|review)\/[^/]+\/?$/;

/**
 * True when the address carries a secret (§12 Data access: order-access, review, newsletter,
 * privacy and reset tokens). Tag Manager is not started on such a page view: GA4 and the Meta
 * Pixel record the full page URL (and later the referrer), which would hand the token to a
 * third party. Signed links always arrive as full page loads; in-app navigations carry none.
 */
export function urlCarriesSecret(location: { pathname: string; search: string }): boolean {
  if (SECRET_PATH.test(location.pathname)) return true;
  const params = new URLSearchParams(location.search);
  return SECRET_QUERY_PARAMS.some((name) => params.has(name));
}
