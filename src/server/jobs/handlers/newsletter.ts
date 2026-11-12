import {
  sendNewsletterConfirmation,
  sendNewsletterWelcome,
  type NewsletterMailDeps,
} from '@/server/modules/customer';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * Newsletter double opt-in e-mails (§2 Marketing). Owner: M3 wave 2 storefront stream.
 * Unsubscribe links are signed with the same secret as the web app's unsubscribe page.
 */
export function createNewsletterHandlers(deps: HandlerDeps) {
  const mail: NewsletterMailDeps = {
    db: deps.db,
    email: deps.email,
    appUrl: deps.appUrl,
    linkSecret: deps.orderLinkSecret,
  };
  return {
    'newsletter.confirm-request': async (payload: JobPayload<'newsletter.confirm-request'>) => {
      await sendNewsletterConfirmation(mail, payload);
    },
    'newsletter.welcome': async (payload: JobPayload<'newsletter.welcome'>) => {
      await sendNewsletterWelcome(mail, payload);
    },
  } as const;
}
