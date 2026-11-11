import type { CheckoutQuote } from '@/server/modules/checkout';
import type { AdminUnit, SavedAddress } from '@/server/modules/customer';

/** Serializable data the checkout page hands to the client form. */
export type CheckoutPageData = {
  locale: 'vi' | 'en';
  checkoutKey: string;
  provinces: AdminUnit[];
  savedAddresses: SavedAddress[];
  /** Wards of the prefilled province (saved default address), so the form starts complete. */
  initialWards: Record<string, AdminUnit[]>;
  quote: CheckoutQuote;
  defaults: {
    email: string;
    phone: string;
    fullName: string;
    couponCode: string;
    savedAddressId: string | null;
    address: { provinceCode: string; wardCode: string; street: string };
  };
  signedIn: boolean;
  links: {
    cart: string;
    signIn: string;
    terms: string | null;
    privacy: string | null;
  };
};

export type { AdminUnit, CheckoutQuote, SavedAddress };
