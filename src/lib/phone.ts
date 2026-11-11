/**
 * Vietnamese mobile numbers (§10.4): 10 digits starting with 0 and a valid carrier prefix
 * (03, 05, 07, 08, 09). `+84`/`84` prefixes, spaces, dots and dashes are accepted and
 * normalised to the national `0xxxxxxxxx` form that orders and addresses store.
 */

const MOBILE_PATTERN = /^0[35789]\d{8}$/;

/** Normalised national form, or `null` when the input is not a Vietnamese mobile number. */
export function normalizeVietnamesePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-()]/g, '');
  let national = compact;
  if (national.startsWith('+84')) national = `0${national.slice(3)}`;
  else if (/^84\d{9}$/.test(national)) national = `0${national.slice(2)}`;
  return MOBILE_PATTERN.test(national) ? national : null;
}

export function isVietnamesePhone(input: string): boolean {
  return normalizeVietnamesePhone(input) !== null;
}
