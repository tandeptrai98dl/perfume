import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { mediaStorageKey } from './media';
import {
  detectImageType,
  MAX_IMAGE_EDGE,
  MAX_UPLOAD_BYTES,
  processImage,
  UploadValidationError,
} from './media-processing';

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 150 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner', Artist: 'Camera Person' } })
    .toBuffer();
}

async function issueOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof UploadValidationError ? error.issue : 'other';
  }
  return null;
}

describe('detectImageType', () => {
  it('trusts magic bytes, not names', async () => {
    expect(await detectImageType(await jpegWithExif(10, 10))).toBe('image/jpeg');
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(await detectImageType(png)).toBe('image/png');
  });

  it('rejects empty, oversized and non-image files', async () => {
    expect(await issueOf(detectImageType(Buffer.alloc(0)))).toBe('emptyFile');
    expect(await issueOf(detectImageType(Buffer.alloc(MAX_UPLOAD_BYTES + 1)))).toBe('fileTooLarge');
    expect(
      await issueOf(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('unsupportedType');
    expect(await issueOf(detectImageType(Buffer.from('%PDF-1.7 fake')))).toBe('unsupportedType');
  });
});

describe('processImage', () => {
  it('re-encodes to WebP, strips EXIF and records dimensions', async () => {
    const result = await processImage(await jpegWithExif(800, 600));
    expect(result.mime).toBe('image/webp');
    expect(result.sourceMime).toBe('image/jpeg');
    expect([result.width, result.height]).toEqual([800, 600]);
    const meta = await sharp(result.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(result.body.includes(Buffer.from('secret-owner'))).toBe(false);
    expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it('caps the long edge at 2400 px without upscaling small images', async () => {
    const large = await processImage(await jpegWithExif(3000, 1500));
    expect([large.width, large.height]).toEqual([MAX_IMAGE_EDGE, 1200]);
    const small = await processImage(await jpegWithExif(120, 90));
    expect([small.width, small.height]).toEqual([120, 90]);
  });

  it('rejects a truncated image as corrupt', async () => {
    const jpeg = await jpegWithExif(200, 200);
    expect(await issueOf(processImage(jpeg.subarray(0, 200)))).toBe('corruptImage');
  });
});

describe('mediaStorageKey', () => {
  it('builds a dated, slugged, unique key', () => {
    expect(
      mediaStorageKey(
        'Cèdre Nocturne EDP.JPG',
        '0192f3a4-b5c6-7d8e-9f00-112233445566',
        new Date('2026-11-05'),
      ),
    ).toBe('media/2026/11/cedre-nocturne-edp-112233445566.webp');
    expect(
      mediaStorageKey('...', '0192f3a4-b5c6-7d8e-9f00-112233445566', new Date('2026-01-05')),
    ).toBe('media/2026/01/image-112233445566.webp');
  });
});
