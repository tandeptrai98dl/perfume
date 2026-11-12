import { publicEnv } from './public-env';

/** Local development fallback, served by `src/app/api/media/[...key]/route.ts`. */
export const LOCAL_MEDIA_BASE_PATH = '/api/media';

/**
 * Public URL of a stored media object. `NEXT_PUBLIC_MEDIA_BASE_URL` points at the bucket or
 * CDN in production. Without it, an absolute `fallback` (e.g. `media.url` for externally hosted
 * images) wins, otherwise development serves files from the local media store.
 */
export function mediaUrl(
  storageKey: string,
  fallback: string | null = null,
  baseUrl: string | undefined = publicEnv.NEXT_PUBLIC_MEDIA_BASE_URL,
): string {
  if (!baseUrl && fallback) return fallback;
  const base = (baseUrl ?? LOCAL_MEDIA_BASE_PATH).replace(/\/+$/, '');
  const key = storageKey
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/${key}`;
}
