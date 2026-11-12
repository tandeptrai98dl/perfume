import { isIP } from 'node:net';

import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { errorFields, logger } from '@/server/lib/logger';
import { createRateLimiter } from '@/server/lib/rate-limit';
import {
  buildPersonalDataExport,
  getExportRequest,
  isExportDownloadable,
  verifyExportLink,
} from '@/server/modules/customer';

/**
 * Personal-data export download (PDPL 91/2025 right of access). Two ways in:
 * - the signed e-mail link (`?e=<expiry>&t=<signature>`, valid PRIVACY_EXPORT_LINK_DAYS), or
 * - the signed-in owner of the request from the privacy centre (same validity window).
 * The JSON is generated on request (never stored); responses are private and uncached.
 */

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });

const querySchema = z.object({
  e: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  t: z.string().max(64).optional(),
});

function notFound() {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request, { params }: RouteContext<'/api/privacy/export/[id]'>) {
  const { id } = await params;
  const url = new URL(request.url);
  const idParsed = z.uuid().safeParse(id);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!idParsed.success || !query.success) return notFound();

  const forwarded =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : 'unknown';
  if (!limiter.hit(`export:${ip}`).ok) {
    return new Response(null, { status: 429, headers: { 'retry-after': '600' } });
  }

  try {
    const db = getDb();
    const exportRequest = await getExportRequest(db, id);
    if (
      !exportRequest ||
      exportRequest.type !== 'export' ||
      exportRequest.status !== 'completed' ||
      !exportRequest.completedAt
    ) {
      return notFound();
    }
    let authorized = false;
    if (query.data.e && query.data.t) {
      authorized = verifyExportLink(serverEnv().BETTER_AUTH_SECRET, id, query.data.e, query.data.t);
    } else {
      const session = await getCustomerSession();
      authorized =
        !!session &&
        !!exportRequest.userId &&
        session.user.id === exportRequest.userId &&
        isExportDownloadable(exportRequest);
    }
    if (!authorized) return notFound();

    const data = await buildPersonalDataExport(db, {
      userId: exportRequest.userId,
      email: exportRequest.email,
    });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="personal-data-${date}.json"`,
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    });
  } catch (error) {
    logger.error('privacy.export_download_failed', errorFields(error));
    return new Response(null, { status: 500 });
  }
}
