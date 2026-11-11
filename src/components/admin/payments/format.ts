/** Money and date formats for the payments admin (VND whole đồng, Vietnam time). */
export const VND = { style: 'currency', currency: 'VND', maximumFractionDigits: 0 } as const;
export const DATE_TIME = { dateStyle: 'short', timeStyle: 'short' } as const;

export type BadgeTone = 'neutral' | 'outline' | 'gold' | 'success' | 'warning' | 'dark';

export const ATTEMPT_TONES: Record<string, BadgeTone> = {
  pending: 'outline',
  succeeded: 'success',
  failed: 'warning',
  expired: 'neutral',
  cancelled: 'neutral',
  refunded: 'gold',
};

export const REFUND_TONES: Record<string, BadgeTone> = {
  requested: 'warning',
  processing: 'outline',
  completed: 'success',
  failed: 'warning',
};

/** Order detail page (admin orders stream). */
export const orderHref = (orderId: string) => `/admin/orders/${orderId}`;
