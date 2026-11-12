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
// ---------- Privacy (M3 privacy stream): consents, data-subject requests, anonymisation ----------
export {
  anonymizePrivacySubject,
  completeExportRequest,
  confirmGuestPrivacyRequest,
  countOpenPrivacyRequests,
  exportDownloadUrl,
  getAccountPrivacyRequest,
  getConsentState,
  getExportRequest,
  getPrivacyNotification,
  getPrivacyRequestDetail,
  listAccountPrivacyRequests,
  listConsentHistory,
  listPrivacyRequests,
  privacyCenterUrl,
  readGuestRequestToken,
  recordCookieChoice,
  requestAccountPrivacy,
  rerunPrivacyExport,
  setPrivacyRequestStatus,
  startGuestPrivacyRequest,
  updateAccountConsents,
  type AdminPrivacyRequestDetail,
  type AdminPrivacyRequestRow,
  type AnonymizeResult,
  type ConsentHistoryEntry,
  type ConsentRequestContext,
  type ConsentState,
  type ErasureStep,
  type PrivacyNotification,
  type PrivacyRequestHistoryEntry,
  type PrivacyRequestView,
} from './privacy-requests';
export {
  canTransitionPrivacyRequest,
  exportLinkExpiry,
  GUEST_VERIFICATION_HOURS,
  isExportDownloadable,
  isOverdue,
  MAX_REQUEST_DETAILS,
  OPEN_PRIVACY_STATUSES,
  PRIVACY_DUE_DAYS,
  PRIVACY_EXPORT_LINK_DAYS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  privacyDueAt,
  signExportLink,
  signGuestRequest,
  verifyExportLink,
  verifyGuestRequest,
  type GuestPrivacyRequest,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from './privacy-rules';
export {
  accountConsentsSchema,
  accountPrivacyRequestSchema,
  anonymizeSubjectSchema,
  cookieChoiceSchema,
  guestPrivacyRequestSchema,
  PRIVACY_REQUEST_FILTERS,
  privacyRequestIdSchema,
  privacyRequestListSchema,
  privacyRequestStatusSchema,
  type AccountConsentsInput,
  type AccountPrivacyRequestInput,
  type CookieChoiceInput,
  type GuestPrivacyRequestInput,
  type PrivacyRequestFilter,
  type PrivacyRequestListQuery,
} from './privacy-schemas';
export {
  buildPersonalDataExport,
  PERSONAL_DATA_EXPORT_FORMAT,
  type ExportSection,
  type PersonalDataExport,
} from './privacy-export';
export {
  ANONYMIZED_NAME,
  anonymizedEmail,
  eraseCustomerData,
  type PrivacySubject,
} from './privacy-erasure';
export {
  processPrivacyExport,
  sendPrivacyNotification,
  sendPrivacyVerification,
  type PrivacyMailDeps,
} from './privacy-emails';
// ---------- End privacy ----------
// ---------- M3 wave 2 (customers & alerts stream): admin customers ----------
export {
  canSeeCustomerContact,
  COD_RISK_ACTION,
  COD_RISK_REASON_MAX,
  COD_RISK_REASON_MIN,
  CUSTOMER_EXPORT_LIMIT,
  CUSTOMER_NOTE_ACTION,
  CUSTOMER_NOTE_MAX,
  CUSTOMER_SORTS,
  CUSTOMER_TYPES,
  customerKeyString,
  displayContact,
  lifetimeSpend,
  NON_SPEND_STATUSES,
  parseCustomerKey,
  parseCustomerSearch,
  type CustomerKey,
  type CustomerSearch,
  type CustomerSort,
  type CustomerType,
} from './admin-rules';
export {
  customerFilterSchema,
  customerListSchema,
  customerNoteSchema,
  setCodRiskFlagSchema,
  type CustomerFilter,
  type CustomerListQuery,
  type CustomerNoteInput,
  type SetCodRiskFlagInput,
} from './admin-schemas';
export {
  countFlaggedCustomers,
  CUSTOMER_ORDER_LIMIT,
  customerPrivacyEmail,
  getCustomerDetail,
  listCustomers,
  listCustomersForExport,
  type CustomerConsent,
  type CustomerDetail,
  type CustomerHistoryEntry,
  type CustomerOrderRow,
  type CustomerRow,
} from './admin-queries';
export { addCustomerNote, exportCustomersCsv, setCodRiskFlag } from './admin-commands';
// ---------- End admin customers ----------
