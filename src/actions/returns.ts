'use server';

import 'server-only';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getProducer } from '@/server/jobs/producer';
import { DomainError, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { findOrderForReturn, requestReturn, returnRequestSchema } from '@/server/modules/returns';
import { hasOrderAccess } from '@/server/order-access';
import { guardRequest } from '@/server/request-guard';

/**
 * Customer return request (ADR-0017, §10.5) from the account order page or the guest order
 * page. Zod first, then the shared rate limit (`returnRequest`, per IP), then access: the
 * signed-in owner of the order, or anyone holding the order's access (signed `?t=` link from
 * an e-mail, or the lookup cookie). Unknown and foreign orders answer the same `notFound`.
 * The module re-checks status, window and lines under the order row lock.
 * Results carry translation codes (`returns.errors.*`).
 */

export type ReturnErrorCode =
  | 'validation'
  | 'notFound'
  | 'rateLimited'
  | 'conflict'
  | 'unexpected'
  | 'windowExpired'
  | 'notDelivered'
  | 'alreadyRequested';

export type ReturnActionResult =
  | { ok: true; requestId: string }
  | { ok: false; error: ReturnErrorCode; fieldErrors: FieldIssue[] };

const CODE_PATTERN = /^[a-zA-Z]+$/;

const inputSchema = z.object({
  code: z.string().trim().min(1).max(32),
  token: z.string().max(256).nullish(),
  request: returnRequestSchema,
});

const ELIGIBILITY_CODES = new Set(['windowExpired', 'notDelivered', 'alreadyRequested']);

export async function requestReturnAction(raw: unknown): Promise<ReturnActionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      fieldErrors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
      })),
    };
  }
  const guard = await guardRequest({ scope: 'returnRequest' });
  if (!guard.ok) return { ok: false, error: 'rateLimited', fieldErrors: [] };

  try {
    const db = getDb();
    const order = await findOrderForReturn(db, parsed.data.code);
    if (!order) return { ok: false, error: 'notFound', fieldErrors: [] };
    const session = await getCustomerSession();
    const owner = !!session && !!order.userId && order.userId === session.user.id;
    if (!owner && !(await hasOrderAccess(order.code, parsed.data.token))) {
      return { ok: false, error: 'notFound', fieldErrors: [] };
    }
    const result = await requestReturn(db, await getProducer(), {
      orderId: order.id,
      userId: owner ? session!.user.id : null,
      values: parsed.data.request,
    });
    refresh();
    return { ok: true, requestId: result.requestId };
  } catch (error) {
    if (error instanceof DomainError) {
      const first = error.fieldErrors[0]?.code;
      if (first && ELIGIBILITY_CODES.has(first)) {
        return { ok: false, error: first as ReturnErrorCode, fieldErrors: [] };
      }
      if (error.code === 'invalid') {
        return {
          ok: false,
          error: 'validation',
          fieldErrors: error.fieldErrors.map((issue) => ({
            path: `request.${issue.path}`,
            code: issue.code,
          })),
        };
      }
      if (error.code === 'notFound' || error.code === 'conflict') {
        return { ok: false, error: error.code, fieldErrors: [] };
      }
    }
    logger.error('returns.request_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}
