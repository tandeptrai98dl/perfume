import {
  processPrivacyExport,
  sendPrivacyNotification,
  sendPrivacyVerification,
  type PrivacyMailDeps,
} from '@/server/modules/customer';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * Data-subject request e-mails and exports (PDPL 91/2025, §10.6). Owner: M3 privacy stream.
 * Export links are signed with the same secret as the web app's download route.
 */
export function createPrivacyHandlers(deps: HandlerDeps) {
  const mail: PrivacyMailDeps = {
    db: deps.db,
    email: deps.email,
    appUrl: deps.appUrl,
    linkSecret: deps.orderLinkSecret,
  };
  return {
    'privacy.verify-request': async (payload: JobPayload<'privacy.verify-request'>) => {
      await sendPrivacyVerification(mail, payload);
    },
    'privacy.notify': async (payload: JobPayload<'privacy.notify'>) => {
      await sendPrivacyNotification(mail, payload);
    },
    'privacy.export': async (payload: JobPayload<'privacy.export'>) => {
      await processPrivacyExport(mail, payload);
    },
  } as const;
}
