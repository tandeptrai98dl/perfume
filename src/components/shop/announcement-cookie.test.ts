import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENT_COOKIE,
  ANNOUNCEMENT_DISMISSED_ATTRIBUTE,
  announcementPaintScript,
} from './announcement-cookie';

function run(cookie: string): boolean {
  const attributes: Record<string, string> = {};
  const document = {
    cookie,
    documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) },
  };
  runInNewContext(announcementPaintScript(), { document });
  return ANNOUNCEMENT_DISMISSED_ATTRIBUTE in attributes;
}

describe('announcement pre-paint script', () => {
  it('marks a dismissed announcement, first or among other cookies', () => {
    expect(run(`${ANNOUNCEMENT_COOKIE}=abc`)).toBe(true);
    expect(run(`cart_token=x; ${ANNOUNCEMENT_COOKIE}=abc`)).toBe(true);
  });

  it('ignores other cookies, including look-alike names', () => {
    expect(run('')).toBe(false);
    expect(run(`cart_token=x; x${ANNOUNCEMENT_COOKIE}=abc`)).toBe(false);
  });
});
