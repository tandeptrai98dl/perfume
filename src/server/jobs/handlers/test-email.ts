import { createTranslator } from 'next-intl';
import { createElement } from 'react';

import type { EmailSender } from '@/server/integrations/email/send';
import { TestEmail } from '@/server/integrations/email/templates/test-email';

import enMessages from '../../../../messages/en.json';
import viMessages from '../../../../messages/vi.json';
import type { JobPayload } from '../definitions';

const MESSAGES = { vi: viMessages, en: enMessages } as const;

export function createTestEmailHandler(email: EmailSender) {
  return async (payload: JobPayload<'system.test-email'>) => {
    const t = createTranslator({
      locale: payload.locale,
      messages: MESSAGES[payload.locale],
      namespace: 'email.test',
    });
    await email.send({
      to: payload.to,
      subject: t('subject'),
      template: createElement(TestEmail, {
        locale: payload.locale,
        heading: t('heading'),
        body: t('body'),
      }),
    });
  };
}
