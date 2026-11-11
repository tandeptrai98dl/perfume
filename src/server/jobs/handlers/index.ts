import type { EmailSender } from '@/server/integrations/email/send';

import type { JobName, JobPayload } from '../definitions';
import { createRevalidateHandler } from './revalidate';
import { createTestEmailHandler } from './test-email';

export type JobHandlers = { [N in JobName]: (payload: JobPayload<N>) => Promise<void> };

export type HandlerDeps = {
  email: EmailSender;
  internalBaseUrl: string;
  internalSecret: string;
  fetch?: typeof fetch;
};

/** One handler per job; the map type guarantees every job in JOBS is handled. */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  return {
    'system.test-email': createTestEmailHandler(deps.email),
    'cache.revalidate': createRevalidateHandler({
      baseUrl: deps.internalBaseUrl,
      secret: deps.internalSecret,
      fetch: deps.fetch,
    }),
  };
}
