import { z } from 'zod';

import { NEWSLETTER_SOURCES } from './newsletter-rules';

/** Public sign-up form (footer, home). Error messages are translation codes. */
export const newsletterSignupSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('emailInvalid').max(254, 'emailInvalid')),
  /** The unticked consent checkbox must be ticked (PDPL: explicit, specific consent). */
  consent: z.literal(true, 'consentRequired'),
  locale: z.enum(['vi', 'en']),
  source: z.enum(NEWSLETTER_SOURCES),
});
export type NewsletterSignupInput = z.input<typeof newsletterSignupSchema>;
export type NewsletterSignupValues = z.output<typeof newsletterSignupSchema>;

export const newsletterConfirmSchema = z.object({ token: z.string().min(10).max(2048) });

export const newsletterUnsubscribeSchema = z.object({
  s: z.uuid(),
  t: z.string().min(16).max(64),
});
export type NewsletterUnsubscribeInput = z.output<typeof newsletterUnsubscribeSchema>;
