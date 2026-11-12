import { describe, expect, it } from 'vitest';

import { guestReviewSchema, memberReviewSchema, reviewFormSchema } from './review';

const valid = {
  rating: 5,
  longevity: 4,
  sillage: null,
  title: '  Gỗ   tuyết tùng  ',
  body: 'Mùi hương ấm áp,\r\n\r\n\r\nlưu hương cả ngày   dài.',
  reviewerName: '  Hương ',
};

describe('reviewFormSchema', () => {
  it('normalizes whitespace and optional fields', () => {
    const parsed = reviewFormSchema.parse({ ...valid, longevity: undefined, title: '' });
    expect(parsed).toEqual({
      rating: 5,
      longevity: null,
      sillage: null,
      title: null,
      body: 'Mùi hương ấm áp,\n\nlưu hương cả ngày dài.',
      reviewerName: 'Hương',
    });
    expect(reviewFormSchema.parse(valid).title).toBe('Gỗ tuyết tùng');
  });

  it('requires a 1–5 star rating', () => {
    for (const rating of [0, 6, 4.5]) {
      const result = reviewFormSchema.safeParse({ ...valid, rating });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('ratingRequired');
    }
  });

  it('rejects scores out of range', () => {
    expect(reviewFormSchema.safeParse({ ...valid, sillage: 9 }).success).toBe(false);
  });

  it('requires a body of 20 to 2000 characters and a name', () => {
    const short = reviewFormSchema.safeParse({ ...valid, body: 'Thơm.' + ' '.repeat(40) });
    expect(short.error?.issues[0]?.message).toBe('bodyTooShort');
    const long = reviewFormSchema.safeParse({ ...valid, body: 'a'.repeat(2001) });
    expect(long.error?.issues[0]?.message).toBe('tooLong');
    const noName = reviewFormSchema.safeParse({ ...valid, reviewerName: '   ' });
    expect(noName.error?.issues[0]?.message).toBe('required');
  });

  it('validates the member line id and the guest token shape', () => {
    expect(memberReviewSchema.safeParse({ ...valid, orderItemId: 'x' }).success).toBe(false);
    expect(
      memberReviewSchema.safeParse({
        ...valid,
        orderItemId: '0195f3c2-7a1b-7c3d-8e4f-a1b2c3d4e5f6',
      }).success,
    ).toBe(true);
    expect(guestReviewSchema.safeParse({ ...valid, token: 'short' }).success).toBe(false);
    expect(guestReviewSchema.safeParse({ ...valid, token: 'a'.repeat(43) }).success).toBe(true);
  });
});
