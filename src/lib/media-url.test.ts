import { describe, expect, it } from 'vitest';

import { mediaUrl } from './media-url';

describe('mediaUrl', () => {
  it('joins the base URL and the storage key', () => {
    expect(mediaUrl('products/a b.jpg', null, 'https://cdn.example.vn/media/')).toBe(
      'https://cdn.example.vn/media/products/a%20b.jpg',
    );
    expect(mediaUrl('/x.avif', null, 'https://cdn.example.vn')).toBe(
      'https://cdn.example.vn/x.avif',
    );
  });

  it('falls back to the stored URL, then to the local media route', () => {
    expect(mediaUrl('x.jpg', 'https://s3.example.vn/x.jpg', undefined)).toBe(
      'https://s3.example.vn/x.jpg',
    );
    expect(mediaUrl('x.jpg', null, undefined)).toBe('/api/media/x.jpg');
  });
});
