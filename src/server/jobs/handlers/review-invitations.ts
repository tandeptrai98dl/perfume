import { scheduleReviewInvitation, sendReviewInvitations } from '@/server/modules/review';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * Review invitations (ADR-0008). `onStatusChanged` runs after the customer e-mail of
 * `order.status-changed` and schedules `review.invite` on the first delivery; `review.invite`
 * creates the guest links and sends the e-mail once per order.
 * Owner: M3 stream "reviews & wishlist".
 */
export function createReviewInvitationHandlers(deps: HandlerDeps) {
  return {
    onStatusChanged: async (payload: JobPayload<'order.status-changed'>) => {
      await scheduleReviewInvitation({ db: deps.db, boss: deps.boss }, payload);
    },
    'review.invite': async ({ orderId }: JobPayload<'review.invite'>) => {
      await sendReviewInvitations({ db: deps.db, email: deps.email, appUrl: deps.appUrl }, orderId);
    },
  } as const;
}
