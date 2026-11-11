import { describe, expect, it } from 'vitest';

import { diffRecords, prefixDiff, REDACTED } from './audit';

describe('diffRecords', () => {
  it('lists only changed fields and ignores timestamps', () => {
    const before = { name: 'A', country: 'FR', updatedAt: new Date(1), tags: ['x'] };
    const after = { name: 'B', country: 'FR', updatedAt: new Date(2), tags: ['x'] };
    expect(diffRecords(before, after)).toEqual({ name: { from: 'A', to: 'B' } });
  });

  it('compares arrays, objects and dates by value', () => {
    expect(
      diffRecords(
        { seasons: ['spring'], doc: { a: 1 }, at: new Date('2026-01-01') },
        { seasons: ['spring', 'summer'], doc: { a: 1 }, at: new Date('2026-01-01') },
      ),
    ).toEqual({ seasons: { from: ['spring'], to: ['spring', 'summer'] } });
  });

  it('describes creations and deletions', () => {
    expect(diffRecords(null, { name: 'A', note: undefined })).toEqual({
      name: { from: null, to: 'A' },
    });
    expect(diffRecords({ name: 'A' }, null)).toEqual({ name: { from: 'A', to: null } });
  });

  it('never stores contact data in clear text', () => {
    expect(diffRecords({ phone: '0901234567' }, { phone: '0907654321' })).toEqual({
      phone: { from: REDACTED, to: REDACTED },
    });
  });

  it('prefixes keys', () => {
    expect(prefixDiff('vi.', { slug: { from: 'a', to: 'b' } })).toEqual({
      'vi.slug': { from: 'a', to: 'b' },
    });
  });
});
