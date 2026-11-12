'use server';

import 'server-only';

import {
  anonymizePrivacySubject,
  anonymizeSubjectSchema,
  privacyRequestIdSchema,
  privacyRequestStatusSchema,
  rerunPrivacyExport,
  setPrivacyRequestStatus,
  type ErasureStep,
} from '@/server/modules/customer';

import { runAdminAction } from './run';
import { anonymizeReviewsForSubject } from '@/server/modules/review';

/**
 * Privacy request queue (§11.2). Permission `privacyRequests.handle` (Owner only, §11.1
 * "Handle privacy requests (export/delete)"); every command writes `audit_logs`.
 */

/**
 * Anonymisation steps of modules owned by other streams (reviews: reviewer name / invitation
 * e-mail; notification logs: recipient). Wired by the orchestrator when those modules export
 * them; the customer, auth, cart and order data is handled by the command itself.
 */
/** Erasure steps owned by other modules (each runs inside the anonymisation transaction). */
const ERASURE_STEPS: readonly ErasureStep[] = [
  async (tx, subject) => {
    await anonymizeReviewsForSubject(tx, subject);
  },
];

export async function setPrivacyRequestStatusAction(raw: unknown) {
  return runAdminAction(privacyRequestStatusSchema, raw, 'privacyRequests.handle', (ctx, input) =>
    setPrivacyRequestStatus(ctx, input),
  );
}

export async function rerunPrivacyExportAction(raw: unknown) {
  return runAdminAction(privacyRequestIdSchema, raw, 'privacyRequests.handle', (ctx, input) =>
    rerunPrivacyExport(ctx, input),
  );
}

export async function anonymizePrivacySubjectAction(raw: unknown) {
  return runAdminAction(anonymizeSubjectSchema, raw, 'privacyRequests.handle', (ctx, input) =>
    anonymizePrivacySubject(ctx, input, ERASURE_STEPS),
  );
}
