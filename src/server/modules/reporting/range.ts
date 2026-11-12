/**
 * Dashboard date ranges (§11.2) in Vietnam time. Vietnam has no daylight saving time, so a
 * fixed UTC+7 offset is exact. Ranges are half-open `[start, end)` instants; `end` is the start
 * of tomorrow (Vietnam), so "today" includes everything placed so far today.
 */

export const RANGE_PRESETS = ['today', '7d', '30d', 'month'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_RANGE: RangePreset = '7d';

export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateRange = {
  preset: RangePreset;
  /** Inclusive start (00:00 Vietnam time of the first day). */
  start: Date;
  /** Exclusive end (00:00 Vietnam time of the day after today). */
  end: Date;
  /** Vietnam calendar days covered, `YYYY-MM-DD`, oldest first. */
  days: string[];
};

/** Start of the Vietnam calendar day containing `instant`, as a UTC instant. */
export function vietnamDayStart(instant: Date): Date {
  const shifted = instant.getTime() + VN_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - VN_OFFSET_MS);
}

/** `YYYY-MM-DD` of the Vietnam calendar day containing `instant`. */
export function vietnamDate(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value);
}

/** Resolves a preset at `now`: today, last 7 / 30 days (today included) or this month so far. */
export function resolveRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = vietnamDayStart(now);
  const end = new Date(today.getTime() + DAY_MS);
  let start: Date;
  switch (preset) {
    case 'today':
      start = today;
      break;
    case '7d':
      start = new Date(today.getTime() - 6 * DAY_MS);
      break;
    case '30d':
      start = new Date(today.getTime() - 29 * DAY_MS);
      break;
    case 'month': {
      const dayOfMonth = Number(vietnamDate(now).slice(8, 10));
      start = new Date(today.getTime() - (dayOfMonth - 1) * DAY_MS);
      break;
    }
  }
  const days: string[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) days.push(vietnamDate(new Date(t)));
  return { preset, start, end, days };
}
