import { randomBytes } from 'node:crypto';

import { and, asc, eq, isNotNull, isNull, like } from 'drizzle-orm';

import { isStaffRole, type StaffRole } from '@/server/auth/permissions';
import { accounts, sessions, twoFactors, users, verifications } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import { diffRecords, recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  isUniqueViolation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';

import { checkStaffChange, type StaffChange } from './rules';
import {
  INVITE_TTL_HOURS,
  type ChangeStaffRoleInput,
  type InviteStaffInput,
  type StaffIdInput,
} from './schemas';

/*
 * Staff management (§11.2 "Staff & audit", RBAC `staff.manage` = Owner). Staff accounts are
 * Better Auth users with a staff role; this module is the staff-administration side of the
 * `customer + auth` area and is the only writer of staff roles, locks and second factors.
 * Every change is audited in the same transaction. Deactivating, resetting 2FA and role
 * changes revoke the account's sessions at once (sessions are read from the DB on every
 * request, so revocation takes effect on the next request).
 */

export type StaffContext = CommandContext & {
  /** Public origin for links in e-mails (APP_URL). */
  appUrl: string;
};

/**
 * Better Auth stores password-reset tokens as `verifications` rows with this identifier
 * prefix and the user id as value; `/api/auth/reset-password` consumes them (and creates the
 * credential account on first use). An invitation is such a token with a longer lifetime.
 * tests/integration/staff/staff.test.ts proves Better Auth accepts it.
 */
const RESET_PASSWORD_PREFIX = 'reset-password:';

export const SET_PASSWORD_PATH = '/admin/set-password';

export function setPasswordUrl(appUrl: string, token: string): string {
  const url = new URL(SET_PASSWORD_PATH, appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

async function issueInvitation(
  ctx: StaffContext,
  tx: Tx,
  user: { id: string; email: string },
): Promise<void> {
  // Earlier, unused links of this account stop working.
  await tx
    .delete(verifications)
    .where(
      and(
        eq(verifications.value, user.id),
        like(verifications.identifier, `${RESET_PASSWORD_PREFIX}%`),
      ),
    );
  const token = randomBytes(32).toString('base64url');
  await tx.insert(verifications).values({
    id: newId(),
    identifier: `${RESET_PASSWORD_PREFIX}${token}`,
    value: user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
  });
  // Outbox: the worker sends the e-mail iff this transaction commits.
  await enqueue(ctx.boss, tx, 'auth.email', {
    to: user.email,
    locale: 'vi',
    kind: 'staff_invite',
    url: setPasswordUrl(ctx.appUrl, token),
  });
}

/**
 * Invites a new staff member: creates the account with its role (no password yet) and e-mails
 * a set-password link. TOTP enrolment is forced on first sign-in (/admin/two-factor). The
 * address counts as verified because only its owner can use the link. Existing accounts
 * (customer or staff) are refused: no silent promotion of a customer account.
 */
export async function inviteStaff(
  ctx: StaffContext,
  input: InviteStaffInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  const id = newId();
  try {
    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing) throw new DomainError('conflict', [{ path: 'email', code: 'emailTaken' }]);
      await tx.insert(users).values({
        id,
        name: input.name,
        email: input.email,
        emailVerified: true,
        role: input.role,
        locale: 'vi',
      });
      await issueInvitation(ctx, tx, { id, email: input.email });
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: 'staff.invite',
        entityType: 'staff',
        entityId: id,
        diff: diffRecords(null, { name: input.name, email: input.email, role: input.role }),
        ip: ctx.ip,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('conflict', [{ path: 'email', code: 'emailTaken' }]);
    }
    throw error;
  }
  return { data: { id }, tags: [] };
}

type LockedTarget = {
  id: string;
  email: string;
  role: StaffRole;
  banned: boolean;
  twoFactorEnabled: boolean;
  activeOwners: number;
};

/**
 * Locks the active Owners (always in id order, so concurrent changes cannot deadlock or both
 * remove "the other" last Owner) and then the target account.
 */
async function lockTarget(tx: Tx, userId: string): Promise<LockedTarget> {
  const owners = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'owner'), eq(users.banned, false), isNull(users.deletedAt)))
    .orderBy(asc(users.id))
    .for('update');
  const [target] = await tx
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      banned: users.banned,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for('update');
  if (!target || !isStaffRole(target.role)) throw new DomainError('notFound');
  return { ...target, role: target.role, activeOwners: owners.length };
}

function enforce(ctx: StaffContext, target: LockedTarget, change: StaffChange) {
  const violation = checkStaffChange({
    actorId: ctx.actor.id,
    target,
    change,
    activeOwners: target.activeOwners,
  });
  if (violation) throw new DomainError(violation.code, [violation.issue]);
}

async function revokeSessions(tx: Tx, userId: string): Promise<number> {
  const revoked = await tx
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return revoked.length;
}

export async function changeStaffRole(
  ctx: StaffContext,
  input: ChangeStaffRoleInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, input.userId);
    enforce(ctx, target, { kind: 'role', role: input.role });
    await tx.update(users).set({ role: input.role }).where(eq(users.id, target.id));
    // Permissions are re-read on every request; signing out also drops pages already open
    // with the old role's navigation.
    const sessionsRevoked = await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'staff.role_change',
      entityType: 'staff',
      entityId: target.id,
      diff: { role: { from: target.role, to: input.role }, sessionsRevoked },
      ip: ctx.ip,
    });
  });
  return { data: { id: input.userId }, tags: [] };
}

/** Locks the account (sign-in refused by the session hook) and signs it out everywhere. */
export async function deactivateStaff(
  ctx: StaffContext,
  input: StaffIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, input.userId);
    enforce(ctx, target, { kind: 'deactivate' });
    await tx.update(users).set({ banned: true }).where(eq(users.id, target.id));
    const sessionsRevoked = await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'staff.deactivate',
      entityType: 'staff',
      entityId: target.id,
      diff: { banned: { from: false, to: true }, sessionsRevoked },
      ip: ctx.ip,
    });
  });
  return { data: { id: input.userId }, tags: [] };
}

export async function reactivateStaff(
  ctx: StaffContext,
  input: StaffIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, input.userId);
    enforce(ctx, target, { kind: 'reactivate' });
    await tx.update(users).set({ banned: false }).where(eq(users.id, target.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'staff.reactivate',
      entityType: 'staff',
      entityId: target.id,
      diff: { banned: { from: true, to: false } },
      ip: ctx.ip,
    });
  });
  return { data: { id: input.userId }, tags: [] };
}

/**
 * Removes the TOTP factor and backup codes and signs the account out: the next sign-in
 * (password only) lands on /admin/two-factor, which forces a new enrolment (§12).
 */
export async function resetStaffTwoFactor(
  ctx: StaffContext,
  input: StaffIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, input.userId);
    enforce(ctx, target, { kind: 'resetTwoFactor' });
    await tx.delete(twoFactors).where(eq(twoFactors.userId, target.id));
    await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, target.id));
    const sessionsRevoked = await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'staff.reset_2fa',
      entityType: 'staff',
      entityId: target.id,
      diff: { twoFactorEnabled: { from: target.twoFactorEnabled, to: false }, sessionsRevoked },
      ip: ctx.ip,
    });
  });
  return { data: { id: input.userId }, tags: [] };
}

/** New set-password link for an invited account that has not set its password yet. */
export async function resendStaffInvite(
  ctx: StaffContext,
  input: StaffIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'staff.manage');
  await ctx.db.transaction(async (tx) => {
    const target = await lockTarget(tx, input.userId);
    if (target.banned) {
      throw new DomainError('invalid', [{ path: 'userId', code: 'alreadyDeactivated' }]);
    }
    const [credential] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, target.id),
          eq(accounts.providerId, 'credential'),
          isNotNull(accounts.password),
        ),
      )
      .limit(1);
    if (credential) {
      throw new DomainError('invalid', [{ path: 'userId', code: 'alreadyActivated' }]);
    }
    await issueInvitation(ctx, tx, target);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'staff.invite_resend',
      entityType: 'staff',
      entityId: target.id,
      diff: null,
      ip: ctx.ip,
    });
  });
  return { data: { id: input.userId }, tags: [] };
}
