/**
 * Contract of `POST /api/returns/request` (customer return request with photos, ADR-0017),
 * shared by the Route Handler and the storefront form. Error codes are `returns.errors.*`.
 */

export const RETURN_REQUEST_PATH = '/api/returns/request';
/** Client-side hints; the server checks again (magic bytes, size, count, re-encoding). */
export const RETURN_PHOTO_LIMIT = 3;
export const RETURN_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const RETURN_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

export type ReturnErrorCode =
  | 'validation'
  | 'notFound'
  | 'rateLimited'
  | 'conflict'
  | 'unexpected'
  | 'windowExpired'
  | 'notDelivered'
  | 'alreadyRequested'
  | 'photosUnavailable'
  | 'payloadTooLarge';

export type ReturnFieldIssue = { path: string; code: string };

export type ReturnRequestResponse =
  | { ok: true; requestId: string }
  | { ok: false; error: ReturnErrorCode; fieldErrors: ReturnFieldIssue[] };
