import { randomBytes } from 'node:crypto';

import { expect as baseExpect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  field,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import { withDb } from './helpers/payment-orders';
import type { StaffAccount } from './helpers/staff';

/*
 * Staff management (M3, desktop): an Owner invites a staff member by e-mail, the invitee sets a
 * password from the link and is sent to the mandatory TOTP enrolment; the Owner changes the
 * role, resets 2FA, locks and unlocks the account, and every change shows in its audit trail.
 * The invitation e-mail is read from the outbox job (the worker does not run during E2E).
 */

const expect = baseExpect.configure({ timeout: 15_000 });

async function invitationUrl(email: string): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ url: string }>(
      `select data->>'url' as url from pgboss.job
       where name = 'auth.email' and data->>'to' = $1 and data->>'kind' = 'staff_invite'
       order by created_on desc limit 1`,
      [email],
    );
    if (!rows[0]) throw new Error('No invitation job found');
    return rows[0].url;
  });
}

async function openStaffMember(page: Page, name: string) {
  await page.goto('/admin/staff');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function userId(email: string): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>('select id from users where email = $1', [
      email,
    ]);
    return rows[0]!.id;
  });
}

test.describe.serial('admin staff management', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = randomBytes(3).toString('hex');
  const invitee = {
    name: `Nhân viên E2E ${run}`,
    email: `e2e-invite-${run}@perfume.test`,
    password: `Moi-${randomBytes(6).toString('base64url')}`,
  };
  let owner: StaffAccount;
  let manager: StaffAccount;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    owner = await createStaff(testInfo.project.use.baseURL!, 'owner');
    manager = await createStaff(testInfo.project.use.baseURL!, 'manager');
  });

  test.afterAll(async () => {
    await withDb((db) =>
      db.query(`update users set banned = true where email = $1`, [invitee.email]),
    );
  });

  test('owner invites a staff member who sets a password and must enrol TOTP', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);

    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Nhân sự', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nhân sự' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Mời nhân sự' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mời nhân sự mới' });
    await field(dialog, 'Họ tên').fill(invitee.name);
    await field(dialog, 'Email').fill(invitee.email);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Mời nhân sự' }).click();
    await expect(toast(page, 'Đã gửi lời mời')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: invitee.email });
    await expect(row.getByText('Đã mời')).toBeVisible();
    await expect(row.getByText('Nhân viên', { exact: true })).toBeVisible();

    // Inviting the same address again is refused.
    await page.getByRole('button', { name: 'Mời nhân sự' }).click();
    await field(dialog, 'Họ tên').fill('Trùng');
    await field(dialog, 'Email').fill(invitee.email);
    await dialog.getByRole('button', { name: 'Mời nhân sự' }).click();
    await expect(dialog.getByText('Email này đã có tài khoản.')).toBeVisible();
    await page.keyboard.press('Escape');

    // The invitee, in a fresh browser without a session.
    const context = await browser.newContext();
    const invitePage = await context.newPage();
    const inviteErrors = collectConsoleErrors(invitePage);
    await invitePage.goto(await invitationUrl(invitee.email));
    await expect(invitePage.getByRole('heading', { level: 1, name: 'Đặt mật khẩu' })).toBeVisible();
    await expectNoAxeViolations(invitePage);
    await field(invitePage, 'Mật khẩu mới').fill(invitee.password);
    await field(invitePage, 'Nhập lại mật khẩu').fill(`${invitee.password}x`);
    await invitePage.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(invitePage.getByText('Hai mật khẩu chưa khớp.')).toBeVisible();
    await field(invitePage, 'Nhập lại mật khẩu').fill(invitee.password);
    await invitePage.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(invitePage.getByText('Đã đặt mật khẩu. Bạn có thể đăng nhập.')).toBeVisible();
    await invitePage.getByRole('link', { name: 'Đến trang đăng nhập' }).click();

    await field(invitePage, 'Email').fill(invitee.email);
    await field(invitePage, 'Mật khẩu').fill(invitee.password);
    await invitePage.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(invitePage).toHaveURL(/\/admin\/two-factor$/);
    await expect(
      invitePage.getByRole('heading', { level: 1, name: 'Bật xác thực hai bước' }),
    ).toBeVisible();
    expect(inviteErrors).toEqual([]);
    await context.close();

    await page.reload();
    await expect(
      page.getByRole('row').filter({ hasText: invitee.email }).getByText('Đang hoạt động'),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('owner changes the role, resets 2FA, locks and unlocks; all audited', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signInAdmin(page, owner);
    await openStaffMember(page, invitee.name);
    await expectNoAxeViolations(page);

    await page.getByLabel('Vai trò', { exact: true }).click();
    await page.getByRole('option', { name: 'Quản lý' }).click();
    await page.getByRole('button', { name: 'Đổi vai trò' }).click();
    const confirmRole = page.getByRole('dialog', { name: `Đổi vai trò của ${invitee.name}` });
    await expectNoAxeViolations(page);
    await confirmRole.getByRole('button', { name: 'Đổi vai trò' }).click();
    await expect(toast(page, 'Đã đổi vai trò')).toBeVisible();

    await page.getByRole('button', { name: 'Đặt lại xác thực hai bước' }).click();
    await page
      .getByRole('dialog', { name: `Đặt lại xác thực hai bước của ${invitee.name}?` })
      .getByRole('button', { name: 'Đặt lại xác thực hai bước' })
      .click();
    await expect(toast(page, 'Đã đặt lại xác thực hai bước')).toBeVisible();

    await page.getByRole('button', { name: 'Khoá tài khoản' }).click();
    await page
      .getByRole('dialog', { name: `Khoá tài khoản của ${invitee.name}?` })
      .getByRole('button', { name: 'Khoá tài khoản' })
      .click();
    await expect(toast(page, 'Đã khoá tài khoản')).toBeVisible();
    await expect(page.getByText('Đã khoá', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Mở khoá' }).click();
    await page
      .getByRole('dialog', { name: `Mở khoá tài khoản của ${invitee.name}?` })
      .getByRole('button', { name: 'Mở khoá' })
      .click();
    await expect(toast(page, 'Đã mở khoá tài khoản')).toBeVisible();

    const trail = page.getByRole('region', { name: 'Thay đổi trên tài khoản này' });
    for (const action of [
      'staff.invite',
      'staff.role_change',
      'staff.reset_2fa',
      'staff.deactivate',
      'staff.reactivate',
    ]) {
      await expect(trail.getByText(action, { exact: true })).toBeVisible();
    }
    // Diff viewer: before/after of the role change; no contact data in the invite entry.
    const roleRow = trail.getByRole('row').filter({ hasText: 'staff.role_change' });
    await roleRow.getByText(/Xem \d+ thay đổi/).click();
    await expect(roleRow.getByRole('cell', { name: 'manager', exact: true })).toBeVisible();
    await expect(trail).not.toContainText(invitee.email);
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test('owners cannot change their own account; managers cannot open staff management', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAdmin(page, owner);
    await page.goto(`/admin/staff/${await userId(owner.email)}`);
    await expect(page.getByText(/không thể tự đổi vai trò/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Khoá tài khoản' })).toHaveCount(0);

    await page.context().clearCookies();
    await signInAdmin(page, manager);
    await expect(
      page
        .getByRole('navigation', { name: 'Điều hướng quản trị' })
        .getByRole('link', { name: 'Nhân sự', exact: true }),
    ).toHaveCount(0);
    await page.goto('/admin/staff');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
  });
});
