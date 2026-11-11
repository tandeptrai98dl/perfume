import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

/**
 * Upload rules (ARCHITECTURE.md §12): images only, checked by magic bytes (never the file
 * name or the browser's MIME type), 10 MB maximum, re-encoded with sharp so EXIF/GPS data and
 * anything hidden in the original are dropped.
 *
 * Output: one master in WebP, at most 2400 px on the long side (§14.1), plus a tiny blur
 * placeholder. Responsive sizes and AVIF are produced on demand by next/image.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;
export const MAX_IMAGE_EDGE = 2400;
/** Decompression-bomb guard: 50 megapixels. */
const MAX_INPUT_PIXELS = 50_000_000;

export type UploadIssue = 'emptyFile' | 'fileTooLarge' | 'unsupportedType' | 'corruptImage';

export class UploadValidationError extends Error {
  constructor(public readonly issue: UploadIssue) {
    super(issue);
    this.name = 'UploadValidationError';
  }
}

export async function detectImageType(
  buffer: Buffer,
): Promise<(typeof ACCEPTED_IMAGE_TYPES)[number]> {
  if (buffer.length === 0) throw new UploadValidationError('emptyFile');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadValidationError('fileTooLarge');
  const type = await fileTypeFromBuffer(buffer);
  const mime = type?.mime as (typeof ACCEPTED_IMAGE_TYPES)[number] | undefined;
  if (!mime || !ACCEPTED_IMAGE_TYPES.includes(mime)) {
    throw new UploadValidationError('unsupportedType');
  }
  return mime;
}

export type ProcessedImage = {
  body: Buffer;
  mime: 'image/webp';
  extension: 'webp';
  width: number;
  height: number;
  sizeBytes: number;
  blurDataUrl: string;
  sourceMime: string;
};

export async function processImage(buffer: Buffer): Promise<ProcessedImage> {
  const sourceMime = await detectImageType(buffer);
  try {
    const { data, info } = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    })
      // Apply the EXIF orientation before metadata is discarded.
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // sharp drops all metadata (EXIF, GPS, XMP) unless keepMetadata/withMetadata is used.
      .webp({ quality: 85, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const blur = await sharp(data)
      .resize(16, 16, { fit: 'inside' })
      .webp({ quality: 40 })
      .toBuffer();

    return {
      body: data,
      mime: 'image/webp',
      extension: 'webp',
      width: info.width,
      height: info.height,
      sizeBytes: data.length,
      blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
      sourceMime,
    };
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError('corruptImage');
  }
}
