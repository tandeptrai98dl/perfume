import { getStorage, IMMUTABLE_CACHE_CONTROL, isPrivateKey } from '@/server/integrations/storage';

/**
 * Serves media from the local filesystem adapter (development without MinIO). With S3 the
 * bucket/CDN serves files directly (NEXT_PUBLIC_MEDIA_BASE_URL) and this route returns 404.
 * Never serves `private/…` objects.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/media/[...key]'>) {
  const storage = getStorage();
  if (!storage || storage.kind !== 'local') return new Response(null, { status: 404 });
  const { key } = await params;
  const path = key.join('/');
  // Private objects (return photos) are served only to staff, by their own route.
  if (isPrivateKey(path)) return new Response(null, { status: 404 });
  let object;
  try {
    object = await storage.get(path);
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
