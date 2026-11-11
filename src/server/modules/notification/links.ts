import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import { computeOrderAccessToken } from '@/server/lib/order-token';

/**
 * Link to the order status page for e-mails: the localized guest order page with the order's
 * access token (`?t=`), so it opens without an account or a lookup (same token as the web
 * app's `orderAccessToken`). Without a secret the link opens the lookup form instead.
 */
export function orderPageUrl(input: {
  appUrl: string;
  locale: 'vi' | 'en';
  code: string;
  secret?: string | null;
}): string {
  const url = new URL(absoluteUrl(input.appUrl, localizedPath(input.locale, '/order-lookup')));
  url.searchParams.set('code', input.code);
  if (input.secret) url.searchParams.set('t', computeOrderAccessToken(input.secret, input.code));
  return url.toString();
}

/** Public tracking pages of carriers that publish one (others: tracking code only). */
export function carrierTrackingUrl(carrier: string, trackingCode: string): string | null {
  const code = encodeURIComponent(trackingCode);
  switch (carrier) {
    case 'ghn':
      return `https://donhang.ghn.vn/?order_code=${code}`;
    case 'ghtk':
      return `https://i.ghtk.vn/${code}`;
    default:
      return null;
  }
}

export function adminOrderUrl(appUrl: string, orderId: string): string {
  return absoluteUrl(appUrl, `/admin/orders/${orderId}`);
}
