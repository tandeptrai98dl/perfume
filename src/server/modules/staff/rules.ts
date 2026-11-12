import type { StaffRole } from '@/server/auth/permissions';
import type { FieldIssue } from '@/server/lib/command-context';

/**
 * Pure guard rules for staff changes (§11.2): nobody changes their own role, access or second
 * factor (another Owner must do it), and the shop always keeps at least one active Owner.
 */

export type StaffChange =
  | { kind: 'role'; role: StaffRole }
  | { kind: 'deactivate' }
  | { kind: 'reactivate' }
  | { kind: 'resetTwoFactor' };

export type StaffTarget = { id: string; role: StaffRole; banned: boolean };

export type StaffRuleViolation = { code: 'forbidden' | 'invalid'; issue: FieldIssue };

export function checkStaffChange(input: {
  actorId: string;
  target: StaffTarget;
  change: StaffChange;
  /** Active (not deactivated, not deleted) Owners, the target included if it is one. */
  activeOwners: number;
}): StaffRuleViolation | null {
  const { actorId, target, change, activeOwners } = input;
  if (target.id === actorId) {
    return { code: 'forbidden', issue: { path: 'userId', code: 'selfChange' } };
  }
  const removesOwner =
    target.role === 'owner' &&
    !target.banned &&
    (change.kind === 'deactivate' || (change.kind === 'role' && change.role !== 'owner'));
  if (removesOwner && activeOwners <= 1) {
    return { code: 'forbidden', issue: { path: 'userId', code: 'lastOwner' } };
  }
  switch (change.kind) {
    case 'role':
      return change.role === target.role
        ? { code: 'invalid', issue: { path: 'role', code: 'roleUnchanged' } }
        : null;
    case 'deactivate':
      return target.banned
        ? { code: 'invalid', issue: { path: 'userId', code: 'alreadyDeactivated' } }
        : null;
    case 'reactivate':
      return target.banned
        ? null
        : { code: 'invalid', issue: { path: 'userId', code: 'alreadyActive' } };
    case 'resetTwoFactor':
      return null;
  }
}
