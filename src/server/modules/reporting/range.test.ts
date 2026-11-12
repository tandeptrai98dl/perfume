import { describe, expect, it } from 'vitest';

import { isRangePreset, resolveRange, vietnamDate, vietnamDayStart } from './range';

describe('vietnamDayStart', () => {
  it('uses the Vietnam calendar day (UTC+7)', () => {
    // 2026-11-12 18:30 UTC = 2026-11-13 01:30 in Vietnam.
    expect(vietnamDayStart(new Date('2026-11-12T18:30:00Z')).toISOString()).toBe(
      '2026-11-12T17:00:00.000Z',
    );
    // 2026-11-12 16:59 UTC = 23:59 on the 12th in Vietnam.
    expect(vietnamDayStart(new Date('2026-11-12T16:59:00Z')).toISOString()).toBe(
      '2026-11-11T17:00:00.000Z',
    );
  });

  it('formats Vietnam dates', () => {
    expect(vietnamDate(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-13');
  });
});

describe('resolveRange', () => {
  const now = new Date('2026-11-13T03:00:00Z'); // 10:00 on 13 Nov in Vietnam

  it('today covers one Vietnam day', () => {
    const range = resolveRange('today', now);
    expect(range.start.toISOString()).toBe('2026-11-12T17:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-13T17:00:00.000Z');
    expect(range.days).toEqual(['2026-11-13']);
  });

  it('7d and 30d include today', () => {
    expect(resolveRange('7d', now).days).toHaveLength(7);
    expect(resolveRange('7d', now).days[0]).toBe('2026-11-07');
    expect(resolveRange('30d', now).days).toHaveLength(30);
  });

  it('month starts on the first day of the Vietnam month', () => {
    const range = resolveRange('month', now);
    expect(range.days[0]).toBe('2026-11-01');
    expect(range.days.at(-1)).toBe('2026-11-13');
    expect(range.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('month on the first of the month (just after midnight in Vietnam) is one day', () => {
    const range = resolveRange('month', new Date('2026-11-30T17:30:00Z'));
    expect(range.days).toEqual(['2026-12-01']);
  });

  it('validates presets', () => {
    expect(isRangePreset('30d')).toBe(true);
    expect(isRangePreset('year')).toBe(false);
  });
});
