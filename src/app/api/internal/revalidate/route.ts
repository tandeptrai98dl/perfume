import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { serverEnv } from '@/lib/env';
import { JOBS } from '@/server/jobs/definitions';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from '@/server/lib/hmac';
import { logger } from '@/server/lib/logger';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Called by the worker to revalidate Next.js cache tags (ARCHITECTURE.md §5.3, §14.1).
 * Authenticated by an HMAC over `${timestamp}.${body}`; there is no user session here, so the
 * signature replaces `requirePermission`.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  const check = verify(
    serverEnv().INTERNAL_API_SECRET,
    body,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
  );
  if (!check.ok) {
    logger.warn('internal.revalidate.rejected', { reason: check.reason });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = JOBS['cache.revalidate'].schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const profile = parsed.data.expire === 'now' ? { expire: 0 } : 'max';
  for (const tag of parsed.data.tags) revalidateTag(tag, profile);
  return NextResponse.json({ revalidated: parsed.data.tags.length });
}
