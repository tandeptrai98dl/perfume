import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { MAX_RETURN_PHOTO_BYTES, processReturnPhoto, returnPhotoKey } from './photos';
import { staffReturnSchema } from './schemas';

const image = (format: 'png' | 'jpeg' | 'gif', width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    [format]()
    .toBuffer();

describe('processReturnPhoto', () => {
  it('re-encodes JPEG/PNG to WebP and drops EXIF', async () => {
    const withExif = await sharp(await image('jpeg'))
      .withExif({ IFD0: { Artist: 'Nguyen Van A' } })
      .toBuffer();
    const out = await processReturnPhoto(withExif);
    expect(out).toMatchObject({ mime: 'image/webp', width: 40, height: 30 });
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((await processReturnPhoto(await image('png'))).mime).toBe('image/webp');
  });

  it('shrinks large photos to 2000 px on the long side', async () => {
    const out = await processReturnPhoto(await image('png', 4000, 1000));
    expect([out.width, out.height]).toEqual([2000, 500]);
  });

  it('refuses empty, oversized, non-image, unsupported and broken files', async () => {
    await expect(processReturnPhoto(Buffer.alloc(0))).rejects.toMatchObject({
      issue: 'photoEmpty',
    });
    await expect(
      processReturnPhoto(Buffer.alloc(MAX_RETURN_PHOTO_BYTES + 1)),
    ).rejects.toMatchObject({ issue: 'photoTooLarge' });
    await expect(
      processReturnPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toMatchObject({ issue: 'photoType' });
    await expect(processReturnPhoto(await image('gif'))).rejects.toMatchObject({
      issue: 'photoType',
    });
    const truncated = (await image('jpeg', 400, 400)).subarray(0, 200);
    await expect(processReturnPhoto(truncated)).rejects.toMatchObject({ issue: 'photoCorrupt' });
  });

  it('keys photos under the private prefix', () => {
    expect(returnPhotoKey('o1', 'p1')).toBe('private/returns/o1/p1.webp');
  });
});

describe('staffReturnSchema', () => {
  const base = {
    orderId: '0192f3a4-b5c6-7d8e-9f01-23456789abcd',
    lines: [{ orderItemId: '0192f3a4-b5c6-7d8e-9f01-23456789abce', quantity: 1 }],
    reason: 'unopened',
    sealIntact: true,
  };

  it('applies the customer rules and an optional override reason', () => {
    expect(staffReturnSchema.parse(base).overrideReason).toBeNull();
    expect(
      staffReturnSchema.safeParse({ ...base, sealIntact: false }).error?.issues[0]?.message,
    ).toBe('sealRequired');
    expect(
      staffReturnSchema.safeParse({ ...base, overrideReason: 'ok' }).error?.issues[0]?.message,
    ).toBe('tooShort');
    expect(
      staffReturnSchema.parse({ ...base, overrideReason: '  Khách ở nước ngoài ' }),
    ).toMatchObject({ overrideReason: 'Khách ở nước ngoài' });
  });
});
