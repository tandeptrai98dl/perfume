import { getStorage, IMMUTABLE_CACHE_CONTROL } from '@/server/integrations/storage';

/**
 * Serves media from the local filesystem adapter (development without MinIO). With S3 the
 * bucket/CDN serves files directly (NEXT_PUBLIC_MEDIA_BASE_URL) and this route returns 404.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/media/[...key]'>) {
  const storage = getStorage();
  if (!storage || storage.kind !== 'local') return new Response(null, { status: 404 });
  const { key } = await params;
  let object;
  try {
    object = await storage.get(key.join('/'));
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!object) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(object.body), {
    headers: {
      'content-type': object.contentType,
      'cache-control': IMMUTABLE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    },
  });
}
