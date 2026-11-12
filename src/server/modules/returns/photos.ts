import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

import type { PrivateStorage } from '@/server/integrations/storage';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { errorFields, logger } from '@/server/lib/logger';
import type { ReturnPhoto } from '@/server/modules/order';

/*
 * Return photos (ADR-0017 "reason and photos", M3 wave 3): up to 3 images per request, checked
 * on the server by magic bytes (never the file name or the browser's type), at most 8 MB each,
 * decoded and re-encoded with sharp — which drops EXIF/GPS/XMP and anything hidden in the file —
 * to WebP of at most 2000 px. Stored privately (`private/returns/<order>/<photo>.webp`) and
 * served to staff only (`/api/admin/orders/<id>/return-photos/<photoId>`).
 */

export const MAX_RETURN_PHOTOS = 3;
export const MAX_RETURN_PHOTO_BYTES = 8 * 1024 * 1024;
export const RETURN_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_EDGE = 2000;
/** Decompression-bomb guard: 40 megapixels. */
const MAX_INPUT_PIXELS = 40_000_000;

export type ReturnPhotoIssue = 'photoEmpty' | 'photoTooLarge' | 'photoType' | 'photoCorrupt';

export class ReturnPhotoError extends Error {
  constructor(public readonly issue: ReturnPhotoIssue) {
    super(issue);
    this.name = 'ReturnPhotoError';
  }
}

export type ProcessedReturnPhoto = {
  body: Buffer;
  mime: 'image/webp';
  width: number;
  height: number;
};

/** Validates one upload and re-encodes it (metadata stripped). */
export async function processReturnPhoto(buffer: Buffer): Promise<ProcessedReturnPhoto> {
  if (buffer.length === 0) throw new ReturnPhotoError('photoEmpty');
  if (buffer.length > MAX_RETURN_PHOTO_BYTES) throw new ReturnPhotoError('photoTooLarge');
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !(RETURN_PHOTO_TYPES as readonly string[]).includes(type.mime)) {
    throw new ReturnPhotoError('photoType');
  }
  try {
    const { data, info } = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    })
      // Apply the EXIF orientation before the metadata is discarded.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // No keepMetadata/withMetadata: EXIF, GPS, XMP and ICC comments are dropped.
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { body: data, mime: 'image/webp', width: info.width, height: info.height };
  } catch {
    throw new ReturnPhotoError('photoCorrupt');
  }
}

export function returnPhotoKey(orderId: string, photoId: string): string {
  return `private/returns/${orderId}/${photoId}.webp`;
}

/**
 * Processes and stores the request's photos before the request transaction. On any failure
 * the photos already stored are deleted and the error is a `DomainError` with field issues
 * (`photos.<index>`). The caller deletes them too if the request itself fails.
 */
export async function storeReturnPhotos(
  storage: PrivateStorage | null,
  orderId: string,
  files: readonly Buffer[],
): Promise<ReturnPhoto[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_RETURN_PHOTOS) {
    throw new DomainError('invalid', [{ path: 'photos', code: 'tooManyPhotos' }]);
  }
  if (!storage) {
    throw new DomainError('invalid', [{ path: 'photos', code: 'photosUnavailable' }]);
  }
  const stored: ReturnPhoto[] = [];
  try {
    for (const [index, file] of files.entries()) {
      let processed: ProcessedReturnPhoto;
      try {
        processed = await processReturnPhoto(file);
      } catch (error) {
        if (error instanceof ReturnPhotoError) {
          throw new DomainError('invalid', [{ path: `photos.${index}`, code: error.issue }]);
        }
        throw error;
      }
      const id = newId();
      const key = returnPhotoKey(orderId, id);
      await storage.put(key, processed.body, processed.mime);
      stored.push({
        id,
        key,
        mime: processed.mime,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.body.length,
      });
    }
    return stored;
  } catch (error) {
    await deleteReturnPhotos(
      storage,
      stored.map((photo) => photo.key),
    );
    throw error;
  }
}

/** Best effort (orphans are harmless: private and unreferenced); never throws. */
export async function deleteReturnPhotos(
  storage: PrivateStorage | null,
  keys: readonly string[],
): Promise<number> {
  if (!storage) return 0;
  let deleted = 0;
  for (const key of keys) {
    try {
      await storage.delete(key);
      deleted += 1;
    } catch (error) {
      logger.warn('returns.photo_delete_failed', errorFields(error));
    }
  }
  return deleted;
}
