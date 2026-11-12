import { describe, expect, it } from 'vitest';

import { ADMIN_SESSION_MAX_AGE_MS, checkAdminSession, type AdminSessionLike } from './admin-access';

const NOW = Date.parse('2026-11-11T12:00:00Z');

function session(overrides: {
  role?: string;
  twoFactorEnabled?: boolean;
  twoFactorVerified?: boolean;
  ageMs?: number;
  banned?: boolean;
}): AdminSessionLike {
  return {
    user: {
      role: overrides.role ?? 'owner',
      twoFactorEnabled: overrides.twoFactorEnabled ?? true,
      banned: overrides.banned ?? false,
    },
    session: {
      twoFactorVerified: overrides.twoFactorVerified ?? true,
      createdAt: new Date(NOW - (overrides.ageMs ?? 0)),
    },
  };
}

describe('checkAdminSession', () => {
  it('accepts a fresh, 2FA-verified staff session', () => {
    expect(checkAdminSession(session({}), 'settings.manage', NOW)).toBeNull();
  });

  it('rejects anonymous visitors and customers', () => {
    expect(checkAdminSession(null, undefined, NOW)).toBe('unauthenticated');
    expect(checkAdminSession(session({ role: 'customer' }), undefined, NOW)).toBe('notStaff');
  });

  it('rejects a deactivated (banned) staff account even with a verified session', () => {
    expect(checkAdminSession(session({ banned: true }), undefined, NOW)).toBe('unauthenticated');
    expect(checkAdminSession(session({ banned: true }), 'settings.manage', NOW)).toBe(
      'unauthenticated',
    );
  });

  it('sends staff without TOTP to enrolment', () => {
    expect(
      checkAdminSession(
        session({ twoFactorEnabled: false, twoFactorVerified: false }),
        undefined,
        NOW,
      ),
    ).toBe('twoFactorSetupRequired');
  });

  it('requires the session itself to have passed the second factor', () => {
    expect(checkAdminSession(session({ twoFactorVerified: false }), undefined, NOW)).toBe(
      'twoFactorRequired',
    );
  });

  it('expires admin sessions after 8 hours', () => {
    expect(
      checkAdminSession(session({ ageMs: ADMIN_SESSION_MAX_AGE_MS }), undefined, NOW),
    ).toBeNull();
    expect(
      checkAdminSession(session({ ageMs: ADMIN_SESSION_MAX_AGE_MS + 1 }), undefined, NOW),
    ).toBe('expired');
  });

  it('checks the permission last', () => {
    expect(checkAdminSession(session({ role: 'editor' }), 'products.editPrices', NOW)).toBe(
      'forbidden',
    );
    expect(checkAdminSession(session({ role: 'editor' }), 'products.editContent', NOW)).toBeNull();
  });
});
