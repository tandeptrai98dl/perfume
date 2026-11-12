import { describe, expect, it } from 'vitest';

import {
  canTransitionPrivacyRequest,
  exportLinkExpiry,
  isExportDownloadable,
  isOverdue,
  privacyDueAt,
  signExportLink,
  signGuestRequest,
  verifyExportLink,
  verifyGuestRequest,
} from './privacy-rules';

const SECRET = 'test-secret-test-secret-test-secret-00';
const NOW = new Date('2026-11-12T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('legal due dates (Decree 356/2025)', () => {
  it('gives 10 days for export and correction, 15 for withdrawal, 20 for deletion', () => {
    expect(privacyDueAt('export', NOW).getTime() - NOW.getTime()).toBe(10 * DAY);
    expect(privacyDueAt('correct', NOW).getTime() - NOW.getTime()).toBe(10 * DAY);
    expect(privacyDueAt('withdraw_consent', NOW).getTime() - NOW.getTime()).toBe(15 * DAY);
    expect(privacyDueAt('delete', NOW).getTime() - NOW.getTime()).toBe(20 * DAY);
  });

  it('flags open requests past their due date only', () => {
    const past = new Date(NOW.getTime() - 1);
    expect(isOverdue({ status: 'received', dueAt: past }, NOW)).toBe(true);
    expect(isOverdue({ status: 'in_progress', dueAt: past }, NOW)).toBe(true);
    expect(isOverdue({ status: 'completed', dueAt: past }, NOW)).toBe(false);
    expect(isOverdue({ status: 'received', dueAt: new Date(NOW.getTime() + DAY) }, NOW)).toBe(
      false,
    );
  });
});

describe('status transitions', () => {
  it('allows received → in progress → completed / rejected and nothing after', () => {
    expect(canTransitionPrivacyRequest('received', 'in_progress')).toBe(true);
    expect(canTransitionPrivacyRequest('received', 'rejected')).toBe(true);
    expect(canTransitionPrivacyRequest('in_progress', 'completed')).toBe(true);
    expect(canTransitionPrivacyRequest('in_progress', 'received')).toBe(false);
    expect(canTransitionPrivacyRequest('completed', 'rejected')).toBe(false);
    expect(canTransitionPrivacyRequest('rejected', 'in_progress')).toBe(false);
  });
});

describe('export download links', () => {
  const id = '019a7c2e-1111-7aaa-8bbb-123456789abc';

  it('verifies a signed link until it expires', () => {
    const expires = exportLinkExpiry(NOW);
    expect(expires.getTime() - NOW.getTime()).toBe(7 * DAY);
    const { e, t } = signExportLink(SECRET, id, expires);
    expect(verifyExportLink(SECRET, id, e, t, NOW)).toBe(true);
    expect(verifyExportLink(SECRET, id, e, t, new Date(expires.getTime() + 1000))).toBe(false);
  });

  it('rejects another request id, a changed expiry, another secret or garbage', () => {
    const { e, t } = signExportLink(SECRET, id, exportLinkExpiry(NOW));
    expect(verifyExportLink(SECRET, '019a7c2e-1111-7aaa-8bbb-123456789abd', e, t, NOW)).toBe(false);
    expect(verifyExportLink(SECRET, id, String(Number(e) + 3600), t, NOW)).toBe(false);
    expect(verifyExportLink(`${SECRET}x`, id, e, t, NOW)).toBe(false);
    expect(verifyExportLink(SECRET, id, 'abc', t, NOW)).toBe(false);
    expect(verifyExportLink(SECRET, id, e, null, NOW)).toBe(false);
  });

  it('lets the account download a completed export during the window', () => {
    const completedAt = NOW;
    const base = { type: 'export', status: 'completed', completedAt };
    expect(isExportDownloadable(base, new Date(NOW.getTime() + DAY))).toBe(true);
    expect(isExportDownloadable(base, new Date(NOW.getTime() + 8 * DAY))).toBe(false);
    expect(isExportDownloadable({ ...base, status: 'received' }, NOW)).toBe(false);
    expect(isExportDownloadable({ ...base, type: 'delete' }, NOW)).toBe(false);
  });
});

describe('guest request tokens', () => {
  const request = {
    email: 'khach@example.com',
    type: 'correct' as const,
    locale: 'vi' as const,
    details: 'Sai địa chỉ giao hàng',
  };

  it('round-trips the signed request for 24 hours', () => {
    const token = signGuestRequest(SECRET, request, NOW);
    expect(verifyGuestRequest(SECRET, token, new Date(NOW.getTime() + 23 * 3600_000))).toEqual(
      request,
    );
    expect(verifyGuestRequest(SECRET, token, new Date(NOW.getTime() + 25 * 3600_000))).toBeNull();
  });

  it('rejects tampered payloads, other secrets and malformed tokens', () => {
    const token = signGuestRequest(SECRET, request, NOW);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), y: 'delete' }),
    ).toString('base64url');
    expect(verifyGuestRequest(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
    expect(verifyGuestRequest(`${SECRET}x`, token, NOW)).toBeNull();
    expect(verifyGuestRequest(SECRET, 'not-a-token', NOW)).toBeNull();
    expect(verifyGuestRequest(SECRET, `${token}.extra`, NOW)).toBeNull();
    expect(verifyGuestRequest(SECRET, null, NOW)).toBeNull();
  });
});
