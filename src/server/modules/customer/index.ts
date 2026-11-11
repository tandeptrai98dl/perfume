/**
 * Customer module public API (account & notifications stream): address book, profile,
 * consents, administrative units. Checkout reads saved addresses through `listAddresses` /
 * `getAddress`; only this module writes `addresses`, `consents` and profile fields of `users`.
 */
export {
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
  type SavedAddress,
} from './addresses';
export {
  CONSENT_POLICY_VERSION,
  getProfile,
  getUserLocale,
  updateProfile,
  type ConsentContext,
  type CustomerProfile,
} from './profile';
export { listProvinces, listWards, unitName, type AdminUnit } from './geo';
export {
  addressSchema,
  MAX_ADDRESSES,
  profileSchema,
  type AddressValues,
  type ProfileValues,
} from '@/lib/validation/account';
