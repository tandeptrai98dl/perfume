'use server';

import 'server-only';

import { serverEnv } from '@/lib/env';
import type { CommandContext } from '@/server/lib/command-context';
import {
  changeStaffRole,
  changeStaffRoleSchema,
  deactivateStaff,
  inviteStaff,
  inviteStaffSchema,
  reactivateStaff,
  resendStaffInvite,
  resetStaffTwoFactor,
  staffIdSchema,
  type StaffContext,
} from '@/server/modules/staff';

import { runAdminAction } from './run';

/*
 * Staff management (§5.2 /admin/staff, RBAC §11.1 "staff management" = Owner): every action
 * needs `staff.manage`; the commands re-check it, refuse changes to your own account and to
 * the last active Owner, revoke sessions and write the audit log.
 */

const PERMISSION = 'staff.manage' as const;

const withAppUrl = (ctx: CommandContext): StaffContext => ({ ...ctx, appUrl: serverEnv().APP_URL });

export async function inviteStaffAction(raw: unknown) {
  return runAdminAction(inviteStaffSchema, raw, PERMISSION, (ctx, input) =>
    inviteStaff(withAppUrl(ctx), input),
  );
}

export async function resendStaffInviteAction(raw: unknown) {
  return runAdminAction(staffIdSchema, raw, PERMISSION, (ctx, input) =>
    resendStaffInvite(withAppUrl(ctx), input),
  );
}

export async function changeStaffRoleAction(raw: unknown) {
  return runAdminAction(changeStaffRoleSchema, raw, PERMISSION, (ctx, input) =>
    changeStaffRole(withAppUrl(ctx), input),
  );
}

export async function deactivateStaffAction(raw: unknown) {
  return runAdminAction(staffIdSchema, raw, PERMISSION, (ctx, input) =>
    deactivateStaff(withAppUrl(ctx), input),
  );
}

export async function reactivateStaffAction(raw: unknown) {
  return runAdminAction(staffIdSchema, raw, PERMISSION, (ctx, input) =>
    reactivateStaff(withAppUrl(ctx), input),
  );
}

export async function resetStaffTwoFactorAction(raw: unknown) {
  return runAdminAction(staffIdSchema, raw, PERMISSION, (ctx, input) =>
    resetStaffTwoFactor(withAppUrl(ctx), input),
  );
}
