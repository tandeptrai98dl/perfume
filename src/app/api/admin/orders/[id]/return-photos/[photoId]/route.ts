import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getPrivateStorage, PRIVATE_CACHE_CONTROL } from '@/server/integrations/storage';
import { errorFields, logger } from '@/server/lib/logger';
import { findReturnPhoto } from '@/server/modules/returns';

/**
 * A customer's return photo, for staff only (`orders.view`, 2FA-verified admin session): the
 * private object is streamed through the app, never from a public URL. The storage key is
 * looked up in the order's timeline (never taken from the URL). `no-store`, no sniffing, no
 * cross-site embedding (Fetch Metadata + CORP).
 */

const paramsSchema = z.object({ id: z.uuid(), photoId: z.uuid() });

const notFound = () =>
  new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET(
  request: NextRequest,
  { params }: RouteContext<'/api/admin/orders/[id]/return-photos/[photoId]'>,
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return notFound();
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return new Response(null, { status: 403 });
  }
  try {
    await requirePermission('orders.view');
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response(null, { status: 403 });
    throw error;
  }

  try {
    const photo = await findReturnPhoto(getDb(), parsed.data.id, parsed.data.photoId);
    const storage = getPrivateStorage();
    if (!photo || !storage) return notFound();
    const object = await storage.get(photo.key);
    if (!object) return notFound();
    return new Response(new Uint8Array(object.body), {
      headers: {
        'content-type': photo.mime,
        'cache-control': PRIVATE_CACHE_CONTROL,
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  } catch (error) {
    logger.error('returns.photo_read_failed', errorFields(error));
    return new Response(null, { status: 500 });
  }
}
