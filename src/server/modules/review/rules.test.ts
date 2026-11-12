import { describe, expect, it } from 'vitest';

import {
  canModerate,
  hashReviewToken,
  INVITATION_TTL_DAYS,
  invitationExpiry,
  invitationState,
  isReviewableOrderStatus,
  newReviewToken,
  roundRating,
  suggestedReviewerName,
  summarize,
} from './rules';

describe('review eligibility', () => {
  it('allows only delivered and completed orders', () => {
    expect(isReviewableOrderStatus('delivered')).toBe(true);
    expect(isReviewableOrderStatus('completed')).toBe(true);
    for (const status of ['pending', 'shipped', 'return_requested', 'returned', 'cancelled']) {
      expect(isReviewableOrderStatus(status)).toBe(false);
    }
  });
});

describe('review tokens', () => {
  it('creates 43-character base64url tokens and stores only a SHA-256 hash', () => {
    const token = newReviewToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newReviewToken()).not.toBe(token);
    const hash = hashReviewToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashReviewToken(token));
    expect(hash).not.toContain(token);
  });

  it('expires 30 days after issue', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    expect(INVITATION_TTL_DAYS).toBe(30);
    expect(invitationExpiry(now).toISOString()).toBe('2026-12-12T00:00:00.000Z');
  });
});

describe('invitationState', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  const base = {
    usedAt: null,
    expiresAt: new Date('2026-11-20T00:00:00Z'),
    orderStatus: 'delivered',
    hasReview: false,
    now,
  };

  it('is valid while unused, unexpired and the order is delivered', () => {
    expect(invitationState(base)).toBe('valid');
    expect(invitationState({ ...base, orderStatus: 'completed' })).toBe('valid');
  });

  it('is used once used or when the line already has a review', () => {
    expect(invitationState({ ...base, usedAt: now })).toBe('used');
    expect(invitationState({ ...base, hasReview: true })).toBe('used');
  });

  it('expires at expires_at', () => {
    expect(invitationState({ ...base, expiresAt: now })).toBe('expired');
  });

  it('is unavailable after a return', () => {
    expect(invitationState({ ...base, orderStatus: 'returned' })).toBe('unavailable');
    expect(invitationState({ ...base, orderStatus: 'return_requested' })).toBe('unavailable');
  });
});

describe('summarize', () => {
  it('returns the empty summary without reviews', () => {
    expect(summarize([])).toEqual({
      count: 0,
      average: 0,
      longevity: null,
      sillage: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it('averages ratings to one decimal and the optional scores over rated reviews only', () => {
    const summary = summarize([
      { rating: 5, longevity: 4, sillage: null },
      { rating: 4, longevity: 5, sillage: 3 },
      { rating: 4, longevity: null, sillage: null },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4.3);
    expect(summary.longevity).toBe(4.5);
    expect(summary.sillage).toBe(3);
    expect(summary.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
  });

  it('rounds like numeric(2,1)', () => {
    expect(roundRating(4.25)).toBe(4.3);
    expect(roundRating(4.24)).toBe(4.2);
  });
});

describe('moderation and names', () => {
  it('moves between approved and rejected but never repeats a decision', () => {
    expect(canModerate('pending', 'approved')).toBe(true);
    expect(canModerate('approved', 'rejected')).toBe(true);
    expect(canModerate('approved', 'approved')).toBe(false);
  });

  it('proposes the given name as display name', () => {
    expect(suggestedReviewerName('Nguyễn Thị Hương')).toBe('Hương');
    expect(suggestedReviewerName('Nguyen Van An')).toBe('An');
    expect(suggestedReviewerName('E2E Review Hương')).toBe('Hương');
    expect(suggestedReviewerName('Jane Doe')).toBe('Jane');
    expect(suggestedReviewerName('   ')).toBe('');
    expect(suggestedReviewerName(null)).toBe('');
  });
});
