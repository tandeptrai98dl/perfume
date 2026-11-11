import { clientEnv } from './env';

/** Local development fallback, served by `src/app/api/media/[...key]/route.ts`. */
export const LOCAL_MEDIA_BASE_PATH = '/api/media';

/**
 * Public URL of a stored media object. `NEXT_PUBLIC_MEDIA_BASE_URL` points at the bucket or
 * CDN in production; without it, development serves files from the local media store.
 */
export function mediaUrl(storageKey: string): string {
  const base = (clientEnv.NEXT_PUBLIC_MEDIA_BASE_URL ?? LOCAL_MEDIA_BASE_PATH).replace(/\/+$/, '');
  const key = storageKey
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/${key}`;
}
