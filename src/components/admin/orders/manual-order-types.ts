/** Client-side values of the manual order form (prices are never part of it). */

export const PAYMENT_OPTIONS = ['cod', 'bank_transfer', 'payment_link'] as const;
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

export type LinkProvider = 'payos' | 'vnpay';

export type ManualOrderValues = {
  customer: { fullName: string; phone: string; email: string; locale: 'vi' | 'en' };
  address: { provinceCode: string; wardCode: string; street: string };
  shippingRateId: string;
  paymentOption: PaymentOption | '';
  linkProvider: LinkProvider;
  confirmNow: boolean;
  transfer: { received: boolean; bankReference: string };
  staffNote: string;
};

/** A picked variant (labels kept for display until the live summary answers). */
export type PickedLine = {
  variantId: string;
  quantity: number;
  productName: string;
  brandName: string;
  sku: string;
  sizeMl: number;
  variantType: 'full_size' | 'travel' | 'tester' | 'gift_set';
  available: number;
};

export const MAX_LINE_QUANTITY = 99;
export const MAX_LINES = 30;
