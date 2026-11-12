import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkAdminSession } from '@/server/auth/admin-access';
import { createAuth, type Auth } from '@/server/auth/config';
import { auditLogs, sessions, twoFactors, users, verifications } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  changeStaffRole,
  deactivateStaff,
  getStaffMember,
  inviteStaff,
  listStaff,
  reactivateStaff,
  resendStaffInvite,
  resetStaffTwoFactor,
  type StaffContext,
} from '@/server/modules/staff';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';
import { totp } from '../helpers/totp';

/*
 * Staff management against real PostgreSQL and a real Better Auth instance: invitation tokens
 * are accepted by Better Auth's reset-password endpoint, deactivation and 2FA resets take
 * effect on sessions, and the last-Owner rule holds under concurrency.
 */

const APP_URL = 'http://localhost:3000';
const PASSWORD = 'staff-password-123';

let h: CommandHarness;
let auth: Auth;

const ctx = (role: 'owner' | 'manager', actorId?: string): StaffContext => ({
  ...h.ctx(role),
  ...(actorId ? { actor: { id: actorId, role } } : {}),
  appUrl: APP_URL,
});

class Browser {
  private cookies = new Map<string, string>();

  async post(path: string, body: unknown): Promise<Response> {
    const response = await auth.handler(
      new Request(`${APP_URL}/api/auth${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', origin: APP_URL, cookie: this.header() },
      }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (/max-age=0/i.test(header) || value === '') this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    return response;
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  session() {
    return auth.api.getSession({ headers: new Headers({ cookie: this.header() }) });
  }
}

async function inviteJobs(to: string) {
  const jobs = (await h.jobs('auth.email')) as unknown as {
    data: { to: string; kind: string; url: string; locale: string };
  }[];
  return jobs.map((job) => job.data).filter((data) => data.to === to);
}

function tokenOf(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

async function expectDomainError(promise: Promise<unknown>, code: string, issue?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (issue) expect((error as DomainError).fieldErrors.map((f) => f.code)).toContain(issue);
}

/** Invites, sets the password through Better Auth and returns the new account id. */
async function onboard(email: string, role: 'owner' | 'manager' | 'staff' | 'editor' = 'staff') {
  const { data } = await inviteStaff(ctx('owner'), { email, name: `Staff ${email}`, role });
  const [job] = await inviteJobs(email);
  const reset = await new Browser().post('/reset-password', {
    newPassword: PASSWORD,
    token: tokenOf(job!.url),
  });
  expect(reset.status).toBe(200);
  return data.id;
}

beforeAll(async () => {
  h = await startCommandHarness();
  auth = createAuth(h.db, {
    APP_URL,
    BETTER_AUTH_SECRET: 'integration-test-secret-integration-test-secret',
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('invitations', () => {
  it('creates the account, a set-password link e-mail (outbox) and an audit row', async () => {
    const { data } = await inviteStaff(ctx('owner'), {
      email: 'lan@perfume.test',
      name: 'Trần Thị Lan',
      role: 'editor',
    });
    const member = await getStaffMember(h.db, data.id);
    expect(member).toMatchObject({ role: 'editor', status: 'invited', twoFactorEnabled: false });

    const [job] = await inviteJobs('lan@perfume.test');
    expect(job).toMatchObject({ kind: 'staff_invite', locale: 'vi' });
    expect(job!.url).toMatch(/^http:\/\/localhost:3000\/admin\/set-password\?token=[\w-]{40,}$/);

    const [audit] = await h.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'staff.invite'), eq(auditLogs.entityId, data.id)));
    expect(audit).toMatchObject({ actorId: h.actorIds.owner, entityType: 'staff' });
    // No contact data in the audit trail.
    expect(JSON.stringify(audit!.diff)).not.toContain('lan@perfume.test');
  });

  it('refuses an e-mail that already has an account (no silent customer promotion)', async () => {
    await expectDomainError(
      inviteStaff(ctx('owner'), { email: 'owner@example.com', name: 'X', role: 'staff' }),
      'invalid',
      'emailTaken',
    );
  });

  it('needs staff.manage', async () => {
    await expectDomainError(
      inviteStaff(ctx('manager'), { email: 'nope@perfume.test', name: 'X', role: 'staff' }),
      'forbidden',
    );
  });

  it('Better Auth accepts the invitation token once; then sign-in requires TOTP enrolment', async () => {
    const id = await onboard('minh@perfume.test');
    expect((await getStaffMember(h.db, id))?.status).toBe('active');

    // Single use.
    const [job] = await inviteJobs('minh@perfume.test');
    const again = await new Browser().post('/reset-password', {
      newPassword: 'another-password-1',
      token: tokenOf(job!.url),
    });
    expect(again.status).toBe(400);

    const browser = new Browser();
    const signIn = await browser.post('/sign-in/email', {
      email: 'minh@perfume.test',
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    expect(checkAdminSession(await browser.session())).toBe('twoFactorSetupRequired');

    await expectDomainError(
      resendStaffInvite(ctx('owner'), { userId: id }),
      'invalid',
      'alreadyActivated',
    );
  });

  it('resending replaces the earlier link', async () => {
    const { data } = await inviteStaff(ctx('owner'), {
      email: 'hoa@perfume.test',
      name: 'Hoa',
      role: 'staff',
    });
    await resendStaffInvite(ctx('owner'), { userId: data.id });
    const [first, second] = await inviteJobs('hoa@perfume.test');
    expect(second).toBeDefined();
    const old = await new Browser().post('/reset-password', {
      newPassword: PASSWORD,
      token: tokenOf(first!.url),
    });
    expect(old.status).toBe(400);
    const fresh = await new Browser().post('/reset-password', {
      newPassword: PASSWORD,
      token: tokenOf(second!.url),
    });
    expect(fresh.status).toBe(200);
  });
});

describe('access changes', () => {
  async function enrolledBrowser(email: string) {
    const browser = new Browser();
    expect((await browser.post('/sign-in/email', { email, password: PASSWORD })).status).toBe(200);
    const enable = await browser.post('/two-factor/enable', { password: PASSWORD });
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get('secret')!;
    expect((await browser.post('/two-factor/verify-totp', { code: totp(secret) })).status).toBe(
      200,
    );
    expect(checkAdminSession(await browser.session())).toBeNull();
    return browser;
  }

  it('deactivation signs the account out everywhere and blocks sign-in until reactivated', async () => {
    const id = await onboard('khoa@perfume.test');
    const browser = await enrolledBrowser('khoa@perfume.test');

    await deactivateStaff(ctx('owner'), { userId: id });
    expect(await browser.session()).toBeNull();
    expect(await h.db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(0);
    expect((await getStaffMember(h.db, id))?.status).toBe('deactivated');

    const blocked = await new Browser().post('/sign-in/email', {
      email: 'khoa@perfume.test',
      password: PASSWORD,
    });
    expect(blocked.ok).toBe(false);

    await expectDomainError(
      deactivateStaff(ctx('owner'), { userId: id }),
      'invalid',
      'alreadyDeactivated',
    );
    await reactivateStaff(ctx('owner'), { userId: id });
    const back = await new Browser().post('/sign-in/email', {
      email: 'khoa@perfume.test',
      password: PASSWORD,
    });
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ twoFactorRedirect: true });

    const actions = await h.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, id));
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['staff.invite', 'staff.deactivate', 'staff.reactivate']),
    );
  });

  it('resetting 2FA removes the factor, signs out and forces a new enrolment', async () => {
    const id = await onboard('phuc@perfume.test');
    const browser = await enrolledBrowser('phuc@perfume.test');

    await resetStaffTwoFactor(ctx('owner'), { userId: id });
    expect(await browser.session()).toBeNull();
    expect(await h.db.select().from(twoFactors).where(eq(twoFactors.userId, id))).toHaveLength(0);

    const next = new Browser();
    const signIn = await next.post('/sign-in/email', {
      email: 'phuc@perfume.test',
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    expect(await signIn.json()).not.toMatchObject({ twoFactorRedirect: true });
    expect(checkAdminSession(await next.session())).toBe('twoFactorSetupRequired');
  });

  it('changes roles, revokes sessions and audits the before/after', async () => {
    const id = await onboard('quan@perfume.test', 'staff');
    const browser = new Browser();
    await browser.post('/sign-in/email', { email: 'quan@perfume.test', password: PASSWORD });
    expect(await browser.session()).not.toBeNull();

    await changeStaffRole(ctx('owner'), { userId: id, role: 'manager' });
    expect((await getStaffMember(h.db, id))?.role).toBe('manager');
    expect(await browser.session()).toBeNull();
    const [audit] = await h.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'staff.role_change'), eq(auditLogs.entityId, id)));
    expect(audit?.diff).toMatchObject({
      role: { from: 'staff', to: 'manager' },
      sessionsRevoked: 1,
    });

    await expectDomainError(
      changeStaffRole(ctx('owner'), { userId: id, role: 'manager' }),
      'invalid',
      'roleUnchanged',
    );
  });

  it('refuses changes to your own account and to non-staff accounts', async () => {
    const self = h.actorIds.owner;
    await expectDomainError(
      changeStaffRole(ctx('owner'), { userId: self, role: 'manager' }),
      'forbidden',
      'selfChange',
    );
    await expectDomainError(deactivateStaff(ctx('owner'), { userId: self }), 'forbidden');
    await expectDomainError(resetStaffTwoFactor(ctx('owner'), { userId: self }), 'forbidden');

    const customer = newId();
    await h.db.insert(users).values({ id: customer, name: 'C', email: 'c@perfume.test' });
    await expectDomainError(deactivateStaff(ctx('owner'), { userId: customer }), 'notFound');
  });

  it('two Owners demoting each other at the same time leave exactly one Owner', async () => {
    // Make the harness owner the only other Owner besides a fresh one.
    const other = await onboard('chu2@perfume.test', 'owner');
    const ownersBefore = await h.db.select().from(users).where(eq(users.role, 'owner'));
    expect(ownersBefore.filter((u) => !u.banned)).toHaveLength(2);

    const results = await Promise.allSettled([
      changeStaffRole(ctx('owner'), { userId: other, role: 'manager' }),
      changeStaffRole(ctx('owner', other), { userId: h.actorIds.owner, role: 'manager' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as DomainError).fieldErrors[0]?.code).toBe('lastOwner');

    const owners = await h.db
      .select()
      .from(users)
      .where(and(eq(users.role, 'owner'), eq(users.banned, false)));
    expect(owners).toHaveLength(1);
    // Restore the harness owner for later tests if it was the one demoted.
    if (owners[0]!.id !== h.actorIds.owner) {
      await h.db.update(users).set({ role: 'owner' }).where(eq(users.id, h.actorIds.owner));
    }
  });
});

describe('listStaff', () => {
  it('lists staff with derived status, filters and search, never customers', async () => {
    const all = await listStaff(h.db, { q: '', status: null });
    expect(all.every((m) => m.role !== ('customer' as string))).toBe(true);
    expect(all[0]?.role).toBe('owner');

    const invited = await listStaff(h.db, { q: '', status: 'invited' });
    expect(invited.map((m) => m.email)).toContain('lan@perfume.test');
    expect(invited.every((m) => m.status === 'invited')).toBe(true);

    const search = await listStaff(h.db, { q: 'TRẦN THỊ', status: null });
    expect(search.map((m) => m.email)).toEqual(['lan@perfume.test']);

    const active = await listStaff(h.db, { q: '', status: 'active' });
    expect(active.map((m) => m.email)).toContain('minh@perfume.test');
  });

  it('keeps no orphaned invitation tokens after password setup', async () => {
    const [minh] = await h.db.select().from(users).where(eq(users.email, 'minh@perfume.test'));
    const tokens = await h.db.select().from(verifications).where(eq(verifications.value, minh!.id));
    expect(tokens).toHaveLength(0);
  });
});
