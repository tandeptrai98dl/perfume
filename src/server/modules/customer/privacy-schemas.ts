import { z } from 'zod';

import {
  MAX_REQUEST_DETAILS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
} from './privacy-rules';

/** Inputs of the privacy centre, the guest request form and the admin queue (Zod v4). */

const locale = z.enum(['vi', 'en']);

/** Cookie banner / preferences / privacy centre choice for the optional cookie categories. */
export const cookieChoiceSchema = z.object({
  analytics: z.boolean(),
  ads: z.boolean(),
  locale,
  source: z.enum(['cookie_banner', 'cookie_preferences', 'privacy_center']),
});
export type CookieChoiceInput = z.output<typeof cookieChoiceSchema>;

/** Privacy centre consent switches; every purpose is optional (only changes are logged). */
export const accountConsentsSchema = z.object({
  locale,
  marketingEmail: z.boolean(),
  marketingSms: z.boolean(),
  analytics: z.boolean(),
  ads: z.boolean(),
});
export type AccountConsentsInput = z.output<typeof accountConsentsSchema>;

const details = z
  .string()
  .trim()
  .max(MAX_REQUEST_DETAILS, 'tooLong')
  .transform((value) => value || null);

export const accountPrivacyRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('export'), locale }),
  z.object({ type: z.literal('delete'), locale, details: details.optional() }),
  z.object({
    type: z.literal('correct'),
    locale,
    details: z.string().trim().min(5, 'required').max(MAX_REQUEST_DETAILS, 'tooLong'),
  }),
]);
export type AccountPrivacyRequestInput = z.output<typeof accountPrivacyRequestSchema>;

export const guestPrivacyRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('email').max(254, 'email')),
    type: z.enum(PRIVACY_REQUEST_TYPES),
    details: details.optional(),
    locale,
  })
  .superRefine((value, ctx) => {
    if (value.type === 'correct' && (!value.details || value.details.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'required' });
    }
  });
export type GuestPrivacyRequestInput = z.output<typeof guestPrivacyRequestSchema>;

// ---------- Admin ----------

export const PRIVACY_REQUEST_FILTERS = ['open', 'overdue', 'completed', 'rejected', 'all'] as const;
export type PrivacyRequestFilter = (typeof PRIVACY_REQUEST_FILTERS)[number];

export const privacyRequestListSchema = z.object({
  filter: z.enum(PRIVACY_REQUEST_FILTERS).default('open'),
  type: z.enum(PRIVACY_REQUEST_TYPES).nullable().default(null),
  q: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type PrivacyRequestListQuery = z.input<typeof privacyRequestListSchema>;

export const privacyRequestStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(PRIVACY_REQUEST_STATUSES).exclude(['received']),
  note: z.string().trim().max(MAX_REQUEST_DETAILS, 'tooLong').optional(),
});

export const privacyRequestIdSchema = z.object({ id: z.uuid() });

export const anonymizeSubjectSchema = z.object({
  id: z.uuid(),
  /** Type-to-confirm: the request e-mail, checked again on the server. */
  confirmEmail: z.string().trim().toLowerCase().max(254),
  note: z.string().trim().max(MAX_REQUEST_DETAILS, 'tooLong').optional(),
});
