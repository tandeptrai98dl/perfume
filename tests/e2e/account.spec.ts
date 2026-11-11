import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';

import { authEmailLink, insertOrder, testIp, uniqueEmail, userRow } from './helpers/account';

/*
 * Account & guest order lookup (M2 account stream): sign-up with e-mail confirmation →
 * profile language → address book → orders list/detail → cancel → sign-out/sign-in with
 * return path; guest lookup by code + phone; password reset. vi and en, desktop and mobile.
 * Auth e-mails are read from the queued `auth.email` job (no SMTP in E2E).
 */

// Server-rendered redirects and actions on a shared CI box: allow slower first responses.
const expect = baseExpect.configure({ timeout: 15_000 });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, page.url()).toBeLessThanOrEqual(0);
}

const PASSWORD = 'E2e-account-pass-1';

const flows = [
  {
    locale: 'vi' as const,
    prefix: '',
    signUp: '/dang-ky',
    signIn: '/dang-nhap',
    account: '/tai-khoan',
    orders: '/tai-khoan/don-hang',
    lookup: '/tra-cuu-don-hang',
    forgot: '/quen-mat-khau',
    t: {
      name: 'Họ và tên',
      email: 'Email',
      password: 'Mật khẩu',
      createAccount: 'Tạo tài khoản',
      signUpTitle: 'Tạo tài khoản',
      checkEmail: 'Hãy kiểm tra hộp thư',
      greeting: 'Xin chào, E2E Hương',
      nav: { profile: 'Hồ sơ', addresses: 'Địa chỉ', orders: 'Đơn hàng', signOut: 'Đăng xuất' },
      phone: 'Số điện thoại',
      otherLanguage: 'English',
      otherLocale: 'en',
      marketing: 'Gửi cho tôi tin tức và ưu đãi dành riêng qua email',
      saveProfile: 'Lưu thay đổi',
      profileSaved: 'Đã lưu hồ sơ.',
      addAddress: 'Thêm địa chỉ',
      recipient: 'Tên người nhận',
      province: 'Tỉnh / thành phố',
      ward: 'Phường / xã',
      search: 'Tìm kiếm…',
      provinceQuery: 'ha noi',
      provinceOption: 'Thành phố Hà Nội',
      wardQuery: 'ba dinh',
      wardOption: 'Phường Ba Đình',
      street: 'Địa chỉ cụ thể',
      isDefault: 'Đặt làm địa chỉ mặc định',
      saveAddress: 'Lưu địa chỉ',
      addressSaved: 'Đã lưu địa chỉ.',
      defaultBadge: 'Mặc định',
      edit: 'Sửa',
      delete: 'Xoá',
      confirmDelete: 'Xoá địa chỉ',
      addressDeleted: 'Đã xoá địa chỉ.',
      orderTitle: (code: string) => `Đơn hàng ${code}`,
      cancel: 'Huỷ đơn hàng',
      confirmCancel: 'Đồng ý huỷ đơn',
      cancelled: 'Đã huỷ',
      cancelledToast: 'Đơn hàng của bạn đã được huỷ.',
      signInSubmit: 'Đăng nhập',
      lookupCode: 'Mã đơn hàng',
      lookupSubmit: 'Tra cứu',
      lookupNotFound: /Không tìm thấy đơn hàng với thông tin này/,
      forgotSubmit: 'Gửi đường dẫn',
      forgotSent: 'Hãy kiểm tra hộp thư',
      newPassword: 'Mật khẩu mới',
      confirmPassword: 'Nhập lại mật khẩu mới',
      resetSubmit: 'Lưu mật khẩu mới',
      resetDone: /Mật khẩu đã được thay đổi/,
    },
  },
  {
    locale: 'en' as const,
    prefix: '/en',
    signUp: '/en/sign-up',
    signIn: '/en/sign-in',
    account: '/en/account',
    orders: '/en/account/orders',
    lookup: '/en/order-lookup',
    forgot: '/en/forgot-password',
    t: {
      name: 'Full name',
      email: 'Email',
      password: 'Password',
      createAccount: 'Create account',
      signUpTitle: 'Create an account',
      checkEmail: 'Check your inbox',
      greeting: 'Hello, E2E Hương',
      nav: { profile: 'Profile', addresses: 'Addresses', orders: 'Orders', signOut: 'Sign out' },
      phone: 'Phone number',
      otherLanguage: 'Tiếng Việt',
      otherLocale: 'vi',
      marketing: 'Send me news and private offers by email',
      saveProfile: 'Save changes',
      profileSaved: 'Profile saved.',
      addAddress: 'Add address',
      recipient: 'Recipient name',
      province: 'Province / city',
      ward: 'Ward / commune',
      search: 'Search…',
      provinceQuery: 'hà nội',
      provinceOption: 'Thanh pho Ha Noi',
      wardQuery: 'ba dinh',
      wardOption: 'Phuong Ba Dinh',
      street: 'Street address',
      isDefault: 'Use as my default address',
      saveAddress: 'Save address',
      addressSaved: 'Address saved.',
      defaultBadge: 'Default',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete address',
      addressDeleted: 'Address deleted.',
      orderTitle: (code: string) => `Order ${code}`,
      cancel: 'Cancel order',
      confirmCancel: 'Yes, cancel order',
      cancelled: 'Cancelled',
      cancelledToast: 'Your order has been cancelled.',
      signInSubmit: 'Sign in',
      lookupCode: 'Order code',
      lookupSubmit: 'Find order',
      lookupNotFound: /We could not find an order with these details/,
      forgotSubmit: 'Send reset link',
      forgotSent: 'Check your inbox',
      newPassword: 'New password',
      confirmPassword: 'Confirm new password',
      resetSubmit: 'Save new password',
      resetDone: /Your password has been changed/,
    },
  },
];

const navLink = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: /Tài khoản|Account/ })
    .getByRole('link', { name, exact: true });

test.beforeEach(async ({ context }) => {
  // Own rate-limit bucket per test (sign-up, lookup), like distinct visitors.
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
});

for (const flow of flows) {
  const { t } = flow;

  test(`account: sign up, profile, addresses, orders, cancel (${flow.locale})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    const email = uniqueEmail(`acct-${flow.locale}`);

    // Sign up → confirmation e-mail (queued job) → link signs in and lands on the account.
    await page.goto(flow.signUp);
    await expect(page.getByRole('heading', { level: 1, name: t.signUpTitle })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByLabel(t.name).fill('E2E Hương');
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.createAccount }).click();
    await expect(page.getByRole('heading', { name: t.checkEmail })).toBeVisible();

    const verifyLink = await authEmailLink(email, 'verify_email');
    await page.goto(verifyLink);
    await expect(page).toHaveURL(new RegExp(`${flow.account}$`));
    await expect(page.getByRole('heading', { level: 1, name: t.greeting })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    // Profile: phone + e-mail language (users.locale) + marketing opt-in (consents).
    await navLink(page, t.nav.profile).click();
    await page.getByLabel(t.phone).fill('091 234 5678');
    await page.getByRole('radio', { name: t.otherLanguage }).check();
    await page.getByRole('checkbox', { name: t.marketing }).check();
    await page.getByRole('button', { name: t.saveProfile }).click();
    await expect(page.getByText(t.profileSaved)).toBeVisible();
    await expect.poll(async () => (await userRow(email))?.locale).toBe(t.otherLocale);
    expect(await userRow(email)).toMatchObject({ phone: '0912345678', consents: 1 });
    await page.reload();
    await expect(page.getByRole('radio', { name: t.otherLanguage })).toBeChecked();
    await expectNoAxeViolations(page);

    // Address book: add (province → ward), add a second default, edit, delete.
    await navLink(page, t.nav.addresses).click();
    const addAddress = async (street: string, makeDefault = false) => {
      await page.getByRole('button', { name: t.addAddress }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(t.recipient).fill('E2E Hương');
      await dialog.getByLabel(t.phone).fill('0912345678');
      await dialog.getByRole('combobox', { name: t.province }).click();
      await page.getByPlaceholder(t.search).fill(t.provinceQuery);
      await page.getByRole('option', { name: t.provinceOption }).click();
      await dialog.getByRole('combobox', { name: t.ward }).click();
      await page.getByPlaceholder(t.search).fill(t.wardQuery);
      await page.getByRole('option', { name: t.wardOption }).click();
      await dialog.getByLabel(t.street).fill(street);
      if (makeDefault) await dialog.getByRole('checkbox', { name: t.isDefault }).check();
      await dialog.getByRole('button', { name: t.saveAddress }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(t.addressSaved).first()).toBeVisible();
    };
    await addAddress('1 Tràng Tiền');
    const cards = page.getByTestId('address-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByText(t.defaultBadge, { exact: true })).toBeVisible();
    await addAddress('2 Lê Lợi', true);
    await expect(cards).toHaveCount(2);
    await expect(
      cards.filter({ hasText: '2 Lê Lợi' }).getByText(t.defaultBadge, { exact: true }),
    ).toBeVisible();
    await expect(
      cards.filter({ hasText: '1 Tràng Tiền' }).getByText(t.defaultBadge, { exact: true }),
    ).toHaveCount(0);

    await cards.filter({ hasText: '1 Tràng Tiền' }).getByRole('button', { name: t.edit }).click();
    await page.getByRole('dialog').getByLabel(t.street).fill('1B Tràng Tiền');
    await page.getByRole('dialog').getByRole('button', { name: t.saveAddress }).click();
    await expect(cards.filter({ hasText: '1B Tràng Tiền' })).toHaveCount(1);

    await cards.filter({ hasText: '2 Lê Lợi' }).getByRole('button', { name: t.delete }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.confirmDelete }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByText(t.defaultBadge, { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    // Orders (inserted for this customer): list → detail → cancel the pending one.
    const pending = await insertOrder({
      email,
      userEmail: email,
      phone: '0912345678',
      locale: flow.locale,
      status: 'pending',
    });
    const processing = await insertOrder({
      email,
      userEmail: email,
      phone: '0912345678',
      locale: flow.locale,
      status: 'processing',
    });
    await navLink(page, t.nav.orders).click();
    const history = page.getByTestId('order-history');
    await expect(history.getByRole('link')).toHaveCount(2);
    await expect(history).toContainText(processing);
    await expectNoAxeViolations(page);

    await history.getByRole('link', { name: new RegExp(pending) }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: t.orderTitle(pending) }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: t.cancel }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.confirmCancel }).click();
    await expect(page.getByText(t.cancelledToast)).toBeVisible();
    await expect(page.getByRole('button', { name: t.cancel })).toHaveCount(0);
    await expect(page.getByRole('main').getByText(t.cancelled).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A processing order cannot be cancelled by the customer.
    await page.goto(`${flow.orders}/${processing}`);
    await expect(
      page.getByRole('heading', { level: 1, name: t.orderTitle(processing) }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: t.cancel })).toHaveCount(0);

    // Sign out, open a private page, sign in again and come back to it.
    await page
      .getByRole('navigation', { name: /Tài khoản|Account/ })
      .getByRole('button', { name: t.nav.signOut })
      .click();
    await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${flow.prefix}/?$`));
    await page.goto(flow.orders);
    await expect(page).toHaveURL(new RegExp(`${flow.signIn}\\?next=`));
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.signInSubmit, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${flow.orders}$`));
    await expect(page.getByTestId('order-history').getByRole('link')).toHaveCount(2);

    expect(errors).toEqual([]);
  });

  test(`guest order lookup with code + phone (${flow.locale})`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const code = await insertOrder({
      email: uniqueEmail('guest'),
      phone: '0987654321',
      locale: flow.locale,
      status: 'awaiting_confirmation',
    });

    await page.goto(flow.lookup);
    await expectNoAxeViolations(page);
    await page.getByLabel(t.lookupCode).fill(code.toLowerCase());
    await page.getByLabel(t.phone).fill('0987654320');
    await page.getByRole('button', { name: t.lookupSubmit }).click();
    await expect(page.getByRole('alert').filter({ hasText: t.lookupNotFound })).toBeVisible();

    await page.getByLabel(t.phone).fill('+84 987 654 321');
    await page.getByRole('button', { name: t.lookupSubmit }).click();
    await expect(page.getByRole('heading', { level: 1, name: t.orderTitle(code) })).toBeVisible();
    await expect(page.getByText('Cèdre Nocturne EDT')).toBeVisible();
    // Read-only: no cancel action for guests.
    await expect(page.getByRole('button', { name: t.cancel })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    expect(errors).toEqual([]);
  });

  test(`password reset by e-mail link (${flow.locale})`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const email = uniqueEmail(`reset-${flow.locale}`);
    await page.goto(flow.signUp);
    await page.getByLabel(t.name).fill('E2E Reset');
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.createAccount }).click();
    await expect(page.getByRole('heading', { name: t.checkEmail })).toBeVisible();
    await page.goto(await authEmailLink(email, 'verify_email'));
    await expect(page).toHaveURL(new RegExp(`${flow.account}$`));
    await page.context().clearCookies();

    await page.goto(flow.forgot);
    await expectNoAxeViolations(page);
    await page.getByLabel(t.email).fill(email);
    await page.getByRole('button', { name: t.forgotSubmit }).click();
    await expect(page.getByRole('heading', { name: t.forgotSent })).toBeVisible();

    await page.goto(await authEmailLink(email, 'reset_password'));
    await page.getByLabel(t.newPassword, { exact: true }).fill('E2e-new-password-2');
    await page.getByLabel(t.confirmPassword).fill('E2e-new-password-2');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: t.resetSubmit }).click();
    await expect(page.getByText(t.resetDone)).toBeVisible();

    await page.goto(flow.signIn);
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill('E2e-new-password-2');
    await page.getByRole('button', { name: t.signInSubmit, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${flow.account}$`));
    expect(errors).toEqual([]);
  });
}
