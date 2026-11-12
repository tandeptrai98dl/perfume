import { describe, expect, it } from 'vitest';

import { checkStaffChange, type StaffChange, type StaffTarget } from './rules';

const owner: StaffTarget = { id: 'owner-2', role: 'owner', banned: false };
const staff: StaffTarget = { id: 'staff-1', role: 'staff', banned: false };

function check(target: StaffTarget, change: StaffChange, activeOwners = 2, actorId = 'owner-1') {
  return checkStaffChange({ actorId, target, change, activeOwners })?.issue.code ?? null;
}

describe('checkStaffChange', () => {
  it('refuses every change to your own account', () => {
    for (const change of [
      { kind: 'role', role: 'manager' },
      { kind: 'deactivate' },
      { kind: 'resetTwoFactor' },
    ] satisfies StaffChange[]) {
      expect(check({ ...owner, id: 'owner-1' }, change)).toBe('selfChange');
    }
  });

  it('keeps the last active Owner', () => {
    expect(check(owner, { kind: 'role', role: 'manager' }, 1)).toBe('lastOwner');
    expect(check(owner, { kind: 'deactivate' }, 1)).toBe('lastOwner');
    expect(check(owner, { kind: 'role', role: 'manager' }, 2)).toBeNull();
    expect(check(owner, { kind: 'deactivate' }, 2)).toBeNull();
    // Resetting 2FA of the last other Owner is allowed: the account stays an Owner.
    expect(check(owner, { kind: 'resetTwoFactor' }, 1)).toBeNull();
  });

  it('allows changing a deactivated Owner even when only one active Owner remains', () => {
    expect(check({ ...owner, banned: true }, { kind: 'role', role: 'staff' }, 1)).toBeNull();
  });

  it('rejects no-op changes', () => {
    expect(check(staff, { kind: 'role', role: 'staff' })).toBe('roleUnchanged');
    expect(check({ ...staff, banned: true }, { kind: 'deactivate' })).toBe('alreadyDeactivated');
    expect(check(staff, { kind: 'reactivate' })).toBe('alreadyActive');
  });

  it('allows normal changes', () => {
    expect(check(staff, { kind: 'role', role: 'manager' })).toBeNull();
    expect(check(staff, { kind: 'deactivate' })).toBeNull();
    expect(check({ ...staff, banned: true }, { kind: 'reactivate' })).toBeNull();
    expect(check(staff, { kind: 'resetTwoFactor' })).toBeNull();
  });

  it('classifies guard violations as forbidden and no-ops as invalid', () => {
    expect(
      checkStaffChange({
        actorId: 'owner-1',
        target: owner,
        change: { kind: 'deactivate' },
        activeOwners: 1,
      })?.code,
    ).toBe('forbidden');
    expect(
      checkStaffChange({
        actorId: 'owner-1',
        target: staff,
        change: { kind: 'reactivate' },
        activeOwners: 1,
      })?.code,
    ).toBe('invalid');
  });
});
