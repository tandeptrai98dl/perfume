import { clientEnv } from './env';

/**
 * Public URL of a stored media object. Joins `NEXT_PUBLIC_MEDIA_BASE_URL` and the storage key;
 * without a base URL it returns `fallback` (e.g. `media.url`), or null when there is none.
 */
export function mediaUrl(
  storageKey: string,
  fallback: string | null = null,
  baseUrl: string | undefined = clientEnv.NEXT_PUBLIC_MEDIA_BASE_URL,
): string | null {
  if (!baseUrl) return fallback || null;
  const key = storageKey.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/${key}`;
}
