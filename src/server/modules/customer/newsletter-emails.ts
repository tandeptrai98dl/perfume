import { createElement } from 'react';

import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';
import type { EmailSender } from '@/server/integrations/email/send';
import {
  NewsletterEmail,
  newsletterEmailSubject,
} from '@/server/integrations/email/templates/newsletter-email';
import { logger } from '@/server/lib/logger';

import {
  getNewsletterWelcome,
  newsletterOneClickUrl,
  newsletterUnsubscribeUrl,
} from './newsletter';

/** Worker side of the newsletter jobs (no PII in logs). */

export type NewsletterMailDeps = {
  db: Database;
  email: EmailSender;
  appUrl: string;
  /** Signs unsubscribe links (BETTER_AUTH_SECRET, same as the web app). */
  linkSecret?: string | null;
};

export async function sendNewsletterConfirmation(
  deps: Pick<NewsletterMailDeps, 'email'>,
  input: { to: string; locale: 'vi' | 'en'; url: string },
) {
  await deps.email.send({
    to: input.to,
    subject: newsletterEmailSubject(input.locale, 'confirm'),
    template: createElement(NewsletterEmail, {
      locale: input.locale,
      kind: 'confirm',
      url: input.url,
    }),
  });
}

/** Welcome e-mail with the unsubscribe link; skipped when the row unsubscribed meanwhile. */
export async function sendNewsletterWelcome(
  deps: NewsletterMailDeps,
  input: { subscriberId: string },
): Promise<boolean> {
  if (!deps.linkSecret) throw new Error('newsletter.welcome needs a link secret');
  const subscriber = await getNewsletterWelcome(deps.db, input.subscriberId);
  if (!subscriber) {
    logger.info('newsletter.welcome.skipped', { subscriberId: input.subscriberId });
    return false;
  }
  const unsubscribeUrl = newsletterUnsubscribeUrl(
    deps.appUrl,
    deps.linkSecret,
    input.subscriberId,
    subscriber.locale,
  );
  await deps.email.send({
    to: subscriber.email,
    subject: newsletterEmailSubject(subscriber.locale, 'welcome'),
    template: createElement(NewsletterEmail, {
      locale: subscriber.locale,
      kind: 'welcome',
      url: absoluteUrl(deps.appUrl, localizedPath(subscriber.locale, '/perfumes')),
      unsubscribeUrl,
    }),
    headers: {
      'List-Unsubscribe': `<${newsletterOneClickUrl(deps.appUrl, deps.linkSecret, input.subscriberId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return true;
}
