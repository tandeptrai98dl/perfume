'use client';

import type { ActionResult } from '@/actions/admin/run';
import type { UploadedMedia } from '@/server/modules/catalog';

export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/avif';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** POSTs one image to the admin upload route (validated and re-encoded on the server). */
export async function uploadImage(
  file: File,
  altVi?: string,
): Promise<ActionResult<UploadedMedia>> {
  // Fast feedback only; the server re-checks size and magic bytes.
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'invalid', fieldErrors: [{ path: 'file', code: 'fileTooLarge' }] };
  }
  const body = new FormData();
  body.set('file', file);
  if (altVi) body.set('altVi', altVi);
  try {
    const response = await fetch('/api/admin/media', { method: 'POST', body });
    const json = (await response.json()) as ActionResult<UploadedMedia>;
    return json;
  } catch {
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}
