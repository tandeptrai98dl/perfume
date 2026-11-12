/**
 * Customer module public API (ARCHITECTURE.md §3.3): address book, profile, consents and the
 * two-level administrative units. Only this module writes `addresses`, `consents` and profile
 * fields of `users`. Shared with the worker: no `server-only`, no Next.js APIs (ADR-0023).
 */

// Administrative units (province → ward)
export { listProvinces, listWards, unitName, type AdminUnit } from './geo';
export { resolveWard, listSavedAddresses, type WardUnit } from './address-queries';

// Address book (account) — checkout reads it through listSavedAddresses / getAddress
export {
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
  type SavedAddress,
} from './addresses';

// Profile + consents
export {
  getProfile,
  getUserLocale,
  updateProfile,
  type ConsentContext,
  type CustomerProfile,
} from './profile';
export {
  CONSENT_POLICY_VERSION,
  recordConsents,
  type ConsentPurpose,
  type ConsentRecord,
} from './consents';
export {
  addressSchema,
  MAX_ADDRESSES,
  profileSchema,
  type AddressValues,
  type ProfileValues,
} from '@/lib/validation/account';

// Manual orders (wave 2): masked customer lookup + server-side resolution of the chosen match
export {
  lookupCustomers,
  resolveCustomerRef,
  type CustomerMatch,
  type CustomerRef,
  type ResolvedCustomer,
} from './lookup';

// ---------- M3 reviews & wishlist stream: member wishlist ----------
export { listWishlistProductIds, MAX_WISHLIST_ITEMS, setWishlisted } from './wishlist';
