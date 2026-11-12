import { createHash, randomBytes } from 'node:crypto';

/**
 * Pure review rules (ADR-0008): who may review what, token handling, aggregates. No database
 * access here, so the rules are unit-tested on their own.
 */

/** Orders whose items can be reviewed: the parcel reached the customer and was kept. */
export const REVIEWABLE_ORDER_STATUSES = ['delivered', 'completed'] as const;

export function isReviewableOrderStatus(status: string): boolean {
  return (REVIEWABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Guest review links stay valid for 30 days (ADR-0008). */
export const INVITATION_TTL_DAYS = 30;
/**
 * The invitation e-mail goes out a few days after delivery, once the customer has worn the
 * scent (the "delivered" e-mail announces it).
 */
export const INVITATION_DELAY_SECONDS = 3 * 24 * 60 * 60;

/** Published reviews per page on the product page. */
export const REVIEWS_PAGE_SIZE = 5;
export const REVIEWS_MAX_PAGE = 200;

/** One-time token for the e-mailed link: 32 random bytes, base64url (43 characters). */
export function newReviewToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the SHA-256 of the token is stored (§12 data access: tokens stored hashed). */
export function hashReviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationState = 'valid' | 'expired' | 'used' | 'unavailable';

/**
 * State of a guest invitation: used once (or the item already has a review) → `used`; past
 * `expires_at` → `expired`; the order is no longer delivered/completed (e.g. returned) →
 * `unavailable`.
 */
export function invitationState(input: {
  usedAt: Date | null;
  expiresAt: Date;
  orderStatus: string;
  hasReview: boolean;
  now?: Date;
}): InvitationState {
  if (input.usedAt || input.hasReview) return 'used';
  if (input.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) return 'expired';
  if (!isReviewableOrderStatus(input.orderStatus)) return 'unavailable';
  return 'valid';
}

/** Allowed moderation moves: anything to approved/rejected, never back to pending. */
export function canModerate(from: ReviewStatus, to: Exclude<ReviewStatus, 'pending'>): boolean {
  return from !== to;
}

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export type ReviewSummary = {
  count: number;
  /** Mean star rating rounded to one decimal (0 without reviews). */
  average: number;
  /** Mean of the optional longevity/sillage scores; null when nobody rated them. */
  longevity: number | null;
  sillage: number | null;
  distribution: RatingDistribution;
};

export const EMPTY_SUMMARY: ReviewSummary = {
  count: 0,
  average: 0,
  longevity: null,
  sillage: null,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

/** One decimal, as stored in `products.rating_avg numeric(2,1)`. */
export function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Aggregates of approved reviews (also used to keep `products.rating_*` in step). */
export function summarize(
  rows: readonly { rating: number; longevity: number | null; sillage: number | null }[],
): ReviewSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  const longevity: number[] = [];
  const sillage: number[] = [];
  for (const row of rows) {
    total += row.rating;
    distribution[row.rating as 1 | 2 | 3 | 4 | 5] += 1;
    if (row.longevity !== null) longevity.push(row.longevity);
    if (row.sillage !== null) sillage.push(row.sillage);
  }
  const mean = (values: number[]) =>
    values.length === 0 ? null : roundRating(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    count: rows.length,
    average: roundRating(total / rows.length),
    longevity: mean(longevity),
    sillage: mean(sillage),
    distribution,
  };
}

/** Common Vietnamese family names (with and without diacritics), first word of a full name. */
const VIETNAMESE_SURNAMES = new Set([
  'nguyen',
  'tran',
  'le',
  'pham',
  'hoang',
  'huynh',
  'phan',
  'vu',
  'vo',
  'dang',
  'bui',
  'do',
  'ho',
  'ngo',
  'duong',
  'ly',
  'trinh',
  'dinh',
  'truong',
  'lam',
  'mai',
  'cao',
  'ta',
  'luong',
]);

function looksVietnamese(words: string[]): boolean {
  const fold = (word: string) =>
    word
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/đ/gi, 'd')
      .toLowerCase();
  // Vietnamese diacritics anywhere, or a common family name first.
  return (
    words.some((word) => fold(word) !== word.toLowerCase()) ||
    VIETNAMESE_SURNAMES.has(fold(words[0]!))
  );
}

/**
 * Display name proposed in the form (the reviewer can change it; it is shown publicly): the
 * given name, i.e. the last word of a Vietnamese full name ("Nguyễn Thị Hương" → "Hương"), the
 * first word otherwise ("Jane Doe" → "Jane").
 */
export function suggestedReviewerName(fullName: string | null): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return (looksVietnamese(words) ? words.at(-1) : words[0])!.slice(0, 60);
}
