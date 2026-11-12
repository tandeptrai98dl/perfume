import { NextResponse } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import type { ReturnErrorCode, ReturnRequestResponse } from '@/lib/returns-request';
import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getPrivateStorage } from '@/server/integrations/storage';
import { getProducer } from '@/server/jobs/producer';
import { DomainError, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  deleteReturnPhotos,
  findOrderForReturn,
  MAX_RETURN_PHOTO_BYTES,
  MAX_RETURN_PHOTOS,
  requestReturn,
  returnRequestSchema,
  storeReturnPhotos,
} from '@/server/modules/returns';
import { hasOrderAccess } from '@/server/order-access';
import { guardRequest } from '@/server/request-guard';

/**
 * Customer return request (ADR-0017, §10.5) from the account or guest order page, with up to
 * three photos. A Route Handler (multipart) rather than a Server Action so photos are not
 * limited by the Server Action body size. Order of checks: Origin (CSRF) and body size, Zod,
 * the shared rate limit (`returnRequest`, per IP), then access — the signed-in owner of the
 * order, or anyone holding its access (signed `?t=` link or the lookup cookie); unknown and
 * foreign orders answer the same `notFound`. Photos are validated, re-encoded (EXIF stripped)
 * and stored privately before the request transaction; the module re-checks status, window
 * and lines under the order row lock, and the photos are deleted again if it refuses.
 */

const MAX_REQUEST_BYTES = MAX_RETURN_PHOTOS * MAX_RETURN_PHOTO_BYTES + 256 * 1024;
const CODE_PATTERN = /^[a-zA-Z]+$/;
const ELIGIBILITY_CODES = new Set(['windowExpired', 'notDelivered', 'alreadyRequested']);

const payloadSchema = z.object({
  code: z.string().trim().min(1).max(32),
  token: z.string().max(256).nullish(),
  request: returnRequestSchema,
});

const photosSchema = z
  .array(
    z
      .instanceof(File, { error: 'photoType' })
      .refine((file) => file.size > 0, { error: 'photoEmpty' })
      .refine((file) => file.size <= MAX_RETURN_PHOTO_BYTES, { error: 'photoTooLarge' }),
  )
  .max(MAX_RETURN_PHOTOS, { error: 'tooManyPhotos' });

function respond(body: ReturnRequestResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function fail(status: number, error: ReturnErrorCode, fieldErrors: FieldIssue[] = []) {
  return respond({ ok: false, error, fieldErrors }, status);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set([new URL(serverEnv().APP_URL).origin, new URL(request.url).origin]);
  return allowed.has(origin);
}

function zodIssues(error: z.ZodError, prefix: string[] = []): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: [...prefix, ...issue.path.map(String)].join('.'),
    code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
  }));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'unexpected');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) {
    return fail(413, 'payloadTooLarge', [{ path: 'photos', code: 'photoTooLarge' }]);
  }

  let form: FormData;
  let json: unknown;
  try {
    form = await request.formData();
    json = JSON.parse(String(form.get('payload') ?? ''));
  } catch {
    return fail(400, 'validation');
  }
  const parsed = payloadSchema.safeParse(json);
  const photos = photosSchema.safeParse(form.getAll('photos'));
  if (!parsed.success || !photos.success) {
    return fail(400, 'validation', [
      ...(parsed.success ? [] : zodIssues(parsed.error)),
      ...(photos.success ? [] : zodIssues(photos.error, ['request', 'photos'])),
    ]);
  }

  const guard = await guardRequest({ scope: 'returnRequest' });
  if (!guard.ok) return fail(429, 'rateLimited');

  let storedKeys: string[] = [];
  const storage = getPrivateStorage();
  try {
    const db = getDb();
    const order = await findOrderForReturn(db, parsed.data.code);
    if (!order) return fail(404, 'notFound');
    const session = await getCustomerSession();
    const owner = !!session && !!order.userId && order.userId === session.user.id;
    if (!owner && !(await hasOrderAccess(order.code, parsed.data.token))) {
      return fail(404, 'notFound');
    }
    const buffers = await Promise.all(
      photos.data.map(async (file) => Buffer.from(await file.arrayBuffer())),
    );
    const stored = await storeReturnPhotos(storage, order.id, buffers);
    storedKeys = stored.map((photo) => photo.key);
    const result = await requestReturn(db, await getProducer(), {
      orderId: order.id,
      userId: owner ? session!.user.id : null,
      values: parsed.data.request,
      photos: stored,
    });
    return respond({ ok: true, requestId: result.requestId });
  } catch (error) {
    await deleteReturnPhotos(storage, storedKeys);
    if (error instanceof DomainError) {
      const first = error.fieldErrors[0]?.code;
      if (first && ELIGIBILITY_CODES.has(first)) return fail(409, first as ReturnErrorCode);
      if (first === 'photosUnavailable') return fail(503, 'photosUnavailable');
      if (error.code === 'invalid') {
        return fail(
          422,
          'validation',
          error.fieldErrors.map((issue) => ({ path: `request.${issue.path}`, code: issue.code })),
        );
      }
      if (error.code === 'notFound') return fail(404, 'notFound');
      if (error.code === 'conflict') return fail(409, 'conflict');
    }
    logger.error('returns.request_failed', errorFields(error));
    return fail(500, 'unexpected');
  }
}
