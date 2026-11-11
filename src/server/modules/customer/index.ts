/**
 * Customer module public API (ARCHITECTURE.md §3.3: accounts, addresses, consents).
 * Shared with the worker: no `server-only`, no Next.js APIs (ADR-0023).
 */

// ---------- Checkout stream (M2): read-only address lookups + consent log ----------
export {
  listProvinces,
  listSavedAddresses,
  listWards,
  resolveWard,
  type AdminUnit,
  type SavedAddress,
  type WardUnit,
} from './address-queries';
export {
  CONSENT_POLICY_VERSION,
  recordConsents,
  type ConsentPurpose,
  type ConsentRecord,
} from './consents';
