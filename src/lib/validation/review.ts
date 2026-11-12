import { z } from 'zod';

/**
 * Review form schema (ADR-0008) shared by the browser (React Hook Form) and the server (the
 * Server Actions and the review module parse it again). Custom messages are translation codes
 * under `reviews.errors.*`, never user-facing text.
 */

export const REVIEW_LIMITS = {
  nameMax: 60,
  titleMax: 120,
  bodyMin: 20,
  bodyMax: 2000,
} as const;

const score = z
  .number({ error: 'ratingRequired' })
  .int('ratingRequired')
  .min(1, 'ratingRequired')
  .max(5, 'ratingRequired');

const optionalScore = z
  .union([z.number().int().min(1).max(5), z.null(), z.undefined()])
  .transform((value) => value ?? null);

/** Collapses runs of whitespace; trims. Line breaks in the body are kept (max two in a row). */
function cleanLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanBody(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const reviewFormSchema = z.object({
  rating: score,
  longevity: optionalScore,
  sillage: optionalScore,
  title: z
    .string()
    .transform(cleanLine)
    .pipe(z.string().max(REVIEW_LIMITS.titleMax, 'tooLong'))
    .optional()
    .transform((value) => (value ? value : null)),
  body: z
    .string()
    .transform(cleanBody)
    .pipe(
      z.string().min(REVIEW_LIMITS.bodyMin, 'bodyTooShort').max(REVIEW_LIMITS.bodyMax, 'tooLong'),
    ),
  reviewerName: z
    .string()
    .transform(cleanLine)
    .pipe(z.string().min(1, 'required').max(REVIEW_LIMITS.nameMax, 'tooLong')),
});

export type ReviewFormInput = z.input<typeof reviewFormSchema>;
export type ReviewFormValues = z.output<typeof reviewFormSchema>;

/** Member review from the account: the order item being reviewed + the form. */
export const memberReviewSchema = reviewFormSchema.extend({ orderItemId: z.uuid() });

/** Guest review from the e-mailed link: the raw one-time token + the form. */
export const REVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const guestReviewSchema = reviewFormSchema.extend({
  token: z.string().regex(REVIEW_TOKEN_PATTERN, 'invalid'),
});
