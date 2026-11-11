import { describe, expect, it } from 'vitest';

import { createRateLimiter, ORDER_LOOKUP_LIMIT } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows `limit` attempts per window and reports the wait', () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ ...ORDER_LOOKUP_LIMIT, now: () => clock });
    for (let i = 4; i >= 0; i -= 1) {
      expect(limiter.hit('1.2.3.4')).toEqual({ ok: true, remaining: i, retryAfterMs: 0 });
    }
    const blocked = limiter.hit('1.2.3.4');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(10 * 60 * 1000);

    clock += 60_000;
    expect(limiter.hit('1.2.3.4').retryAfterMs).toBe(9 * 60 * 1000);
    // Other keys are independent.
    expect(limiter.hit('5.6.7.8').ok).toBe(true);
  });

  it('starts a new window once the old one has passed', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => clock });
    expect(limiter.hit('k').ok).toBe(true);
    expect(limiter.hit('k').ok).toBe(false);
    clock = 1_000;
    expect(limiter.hit('k').ok).toBe(true);
  });

  it('bounds memory by evicting expired and then oldest keys', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => clock });
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c'); // evicts "a"
    expect(limiter.hit('a').ok).toBe(true); // fresh window: "a" was forgotten
    clock = 5_000;
    expect(limiter.hit('b').ok).toBe(true);
  });

  it('reset clears one key or everything', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    limiter.hit('x');
    limiter.reset('x');
    expect(limiter.hit('x').ok).toBe(true);
    limiter.reset();
    expect(limiter.hit('x').ok).toBe(true);
  });
});
