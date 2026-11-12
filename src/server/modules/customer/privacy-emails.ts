import { createElement } from 'react';

import type { Database } from '@/server/db/client';
import type { EmailSender } from '@/server/integrations/email/send';
import {
  PrivacyEmail,
  privacyEmailSubject,
} from '@/server/integrations/email/templates/privacy-email';
import { logger } from '@/server/lib/logger';

import {
  completeExportRequest,
  exportDownloadUrl,
  getPrivacyNotification,
  privacyCenterUrl,
} from './privacy-requests';
import type { PrivacyRequestType } from './privacy-rules';

/** Worker side of the privacy jobs: e-mails to the requester (no PII in logs). */

export type PrivacyMailDeps = {
  db: Database;
  email: EmailSender;
  appUrl: string;
  /** Signs export download links (BETTER_AUTH_SECRET, same as the web app). */
  linkSecret?: string | null;
};

export async function sendPrivacyVerification(
  deps: Pick<PrivacyMailDeps, 'email'>,
  input: { to: string; locale: 'vi' | 'en'; type: PrivacyRequestType; url: string },
) {
  await deps.email.send({
    to: input.to,
    subject: privacyEmailSubject(input.locale, 'verify'),
    template: createElement(PrivacyEmail, {
      locale: input.locale,
      kind: 'verify',
      type: input.type,
      url: input.url,
    }),
  });
}

export async function sendPrivacyNotification(
  deps: PrivacyMailDeps,
  input: { requestId: string; kind: 'received' | 'completed' | 'rejected' },
): Promise<boolean> {
  const request = await getPrivacyNotification(deps.db, input.requestId);
  if (!request) {
    logger.warn('privacy.notify.request_missing', { requestId: input.requestId });
    return false;
  }
  // Exports announce themselves with the download link (privacy.export).
  if (input.kind === 'completed' && request.type === 'export') return false;
  await deps.email.send({
    to: request.email,
    subject: privacyEmailSubject(request.locale, input.kind),
    template: createElement(PrivacyEmail, {
      locale: request.locale,
      kind: input.kind,
      type: request.type,
      dueAt: input.kind === 'received' ? request.dueAt : null,
      note: input.kind === 'rejected' ? request.note : null,
      // Deleted accounts have no privacy centre any more.
      url:
        input.kind === 'completed' && request.type === 'delete'
          ? null
          : privacyCenterUrl(deps.appUrl, request.locale),
    }),
  });
  return true;
}

export async function processPrivacyExport(
  deps: PrivacyMailDeps,
  input: { requestId: string; now?: Date },
): Promise<boolean> {
  if (!deps.linkSecret) throw new Error('privacy.export needs a link secret');
  const done = await completeExportRequest(deps.db, input.requestId, input.now);
  if (!done) {
    logger.info('privacy.export.skipped', { requestId: input.requestId });
    return false;
  }
  await deps.email.send({
    to: done.email,
    subject: privacyEmailSubject(done.locale, 'exportReady'),
    template: createElement(PrivacyEmail, {
      locale: done.locale,
      kind: 'exportReady',
      type: 'export',
      url: exportDownloadUrl(deps.appUrl, deps.linkSecret, input.requestId, done.expiresAt),
      expiresAt: done.expiresAt,
    }),
  });
  return true;
}
