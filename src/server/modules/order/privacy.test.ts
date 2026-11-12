import { describe, expect, it } from 'vitest';

import { ANONYMIZED_TEXT, CLOSED_ORDER_STATUSES, scrubEventDiff } from './privacy';

describe('scrubEventDiff', () => {
  it('replaces contact fields of an edited address and keeps the rest', () => {
    const diff = {
      address: {
        fullName: { from: 'Nguyễn Văn A', to: 'Nguyễn Văn B' },
        phone: { from: '0912345678', to: '0987654321' },
        street: { from: '1 Lê Lợi', to: '2 Lê Lợi' },
        wardCode: { from: '001', to: '002' },
      },
      totals: { total: { from: 100, to: 200 } },
    };
    const { diff: scrubbed, changed } = scrubEventDiff(diff);
    expect(changed).toBe(true);
    expect(scrubbed).toEqual({
      address: {
        fullName: { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT },
        phone: { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT },
        street: { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT },
        wardCode: { from: '001', to: '002' },
      },
      totals: { total: { from: 100, to: 200 } },
    });
  });

  it('leaves diffs without contact fields untouched', () => {
    expect(scrubEventDiff({ items: [] }).changed).toBe(false);
    expect(scrubEventDiff({ address: { wardCode: { from: 'a', to: 'b' } } }).changed).toBe(false);
    expect(scrubEventDiff(null).changed).toBe(false);
    expect(scrubEventDiff([1, 2]).changed).toBe(false);
  });
});

describe('CLOSED_ORDER_STATUSES', () => {
  it('only contains finished orders', () => {
    expect([...CLOSED_ORDER_STATUSES].sort()).toEqual(['cancelled', 'completed', 'returned']);
  });
});
