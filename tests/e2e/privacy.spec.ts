import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';

import { readCookieConsent } from '../../src/lib/privacy/cookie-consent';
import { authEmailLink, testIp, uniqueEmail } from './helpers/account';
import {
  completeExport,
  consentRow,
  privacyRequestsFor,
  userConsents,
  verificationLink,
} from './helpers/privacy';

/*
 * Privacy (M3): cookie notice (accept / reject / preferences, GTM never before consent),
 * privacy centre (consents, history, export download, correction, deletion) and the guest
 * request form with e-mail confirmation. vi and en, desktop and mobile.
 *
 * GTM: with NEXT_PUBLIC_GTM_ID set for the build and this run, the spec also checks that the
 * container is requested right after consent; without it, that nothing is ever requested.
 */

const expect = baseExpect.configure({ timeout: 15_000 });
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const PASSWORD = 'E2e-privacy-pass-1';

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('[data-sonner-toast][data-front="false"]')
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

/** Counts (and stubs) every request to Google Tag Manager. */
async function trackGtm(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('https://www.googletagmanager.com/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  return requests;
}

async function consentCookie(page: Page) {
  const cookies = await page.context().cookies();
  const cookie = cookies.find((c) => c.name === 'cookie_consent');
  return cookie ? readCookieConsent(`cookie_consent=${cookie.value}`) : null;
}

const flows = [
  {
    locale: 'vi' as const,
    home: '/',
    privacyCenter: '/tai-khoan/quyen-rieng-tu',
    guestForm: '/quyen-rieng-tu/yeu-cau',
    t: {
      bannerTitle: 'Chúng tôi dùng cookie',
      rejectAll: 'Từ chối tất cả',
      acceptAll: 'Chấp nhận tất cả',
      customize: 'Tuỳ chỉnh',
      settings: 'Cài đặt cookie',
      preferences: 'Tuỳ chỉnh cookie',
      analytics: 'Phân tích',
      saveChoice: 'Lưu lựa chọn',
      saved: 'Đã lưu lựa chọn cookie của bạn.',
      centerTitle: 'Quyền riêng tư',
      marketingEmail: 'Email khuyến mãi',
      saveConsents: 'Lưu thay đổi',
      consentsSaved: 'Đã cập nhật sự đồng ý.',
      requestCopy: 'Yêu cầu bản sao',
      exportSent: 'Liên kết tải dữ liệu sẽ được gửi qua email',
      exportType: 'Nhận bản sao dữ liệu',
      download: 'Tải dữ liệu (JSON)',
      correctionLabel: 'Thông tin cần chỉnh sửa',
      sendRequest: 'Gửi yêu cầu',
      correctType: 'Chỉnh sửa dữ liệu',
      requestDelete: 'Yêu cầu xoá dữ liệu',
      understood: 'Tôi hiểu việc xoá không thể hoàn tác.',
      submitDelete: 'Gửi yêu cầu xoá',
      deleteType: 'Xoá dữ liệu',
      guestTitle: 'Yêu cầu về dữ liệu cá nhân',
      email: 'Email',
      withdraw: 'Rút lại sự đồng ý tiếp thị',
      guestSent: 'bạn sẽ nhận được liên kết xác nhận',
      confirmTitle: 'Xác nhận yêu cầu',
      confirm: 'Xác nhận yêu cầu',
      confirmDone: 'bạn sẽ không nhận tin khuyến mãi nữa',
      invalidTitle: 'Liên kết không còn hiệu lực',
    },
  },
  {
    locale: 'en' as const,
    home: '/en',
    privacyCenter: '/en/account/privacy',
    guestForm: '/en/privacy-request',
    t: {
      bannerTitle: 'We use cookies',
      rejectAll: 'Reject all',
      acceptAll: 'Accept all',
      customize: 'Customise',
      settings: 'Cookie settings',
      preferences: 'Cookie preferences',
      analytics: 'Analytics',
      saveChoice: 'Save my choice',
      saved: 'Your cookie choice has been saved.',
      centerTitle: 'Privacy',
      marketingEmail: 'Promotional e-mails',
      saveConsents: 'Save changes',
      consentsSaved: 'Your consents have been updated.',
      requestCopy: 'Request a copy',
      exportSent: 'The download link will be e-mailed to you',
      exportType: 'Copy of my data',
      download: 'Download data (JSON)',
      correctionLabel: 'What needs correcting',
      sendRequest: 'Send request',
      correctType: 'Correct my data',
      requestDelete: 'Request deletion',
      understood: 'I understand that deletion cannot be undone.',
      submitDelete: 'Request deletion',
      deleteType: 'Delete my data',
      guestTitle: 'Personal data requests',
      email: 'E-mail',
      withdraw: 'Withdraw marketing consent',
      guestSent: 'a confirmation link is on its way',
      confirmTitle: 'Confirm your request',
      confirm: 'Confirm request',
      confirmDone: 'you will no longer receive promotional messages',
      invalidTitle: 'This link is no longer valid',
    },
  },
];

for (const { locale, home, privacyCenter, guestForm, t } of flows) {
  test.describe(`cookie notice (${locale})`, () => {
    // Fresh visitor: no answered notice (the config pre-answers it for other specs).
    test.use({ storageState: { cookies: [], origins: [] } });

    test(`reject all: nothing optional loads, choice is logged (${locale})`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const gtm = await trackGtm(page);
      await page.goto(home);
      const banner = page.getByRole('region', { name: t.bannerTitle });
      await expect(banner).toBeVisible();
      // Equal weight: both answers are plain buttons with the same style.
      const reject = banner.getByRole('button', { name: t.rejectAll });
      const accept = banner.getByRole('button', { name: t.acceptAll });
      expect(await reject.getAttribute('class')).toBe(await accept.getAttribute('class'));
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
      expect(gtm).toEqual([]);

      await reject.click();
      await expect(banner).toBeHidden();
      await expect(page.getByText(t.saved)).toBeVisible();
      const consent = await consentCookie(page);
      expect(consent).toMatchObject({ analytics: false, ads: false });
      expect(await consentRow(consent!.receiptId!)).toMatchObject({
        purpose: 'analytics',
        granted: false,
        source: 'cookie_banner',
      });

      await page.reload();
      await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
      await page.waitForLoadState('networkidle');
      expect(gtm).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`accept all: GTM only after consent; preferences re-open from the footer (${locale})`, async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);
      const gtm = await trackGtm(page);
      await page.goto(home);
      const banner = page.getByRole('region', { name: t.bannerTitle });
      await expect(banner).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(gtm).toEqual([]);
      expect(await page.locator('script[data-consent-gated="gtm"]').count()).toBe(0);

      await banner.getByRole('button', { name: t.acceptAll }).click();
      await expect(banner).toBeHidden();
      expect(await consentCookie(page)).toMatchObject({ analytics: true, ads: true });
      if (GTM_ID) {
        await expect.poll(() => gtm.length).toBe(1);
        expect(gtm[0]).toContain(`id=${GTM_ID}`);
        const consentMode = await page.evaluate(() =>
          ((window as unknown as { dataLayer: unknown[] }).dataLayer ?? [])
            .map((entry) => Array.from(entry as ArrayLike<unknown>))
            .filter((args) => args[0] === 'consent'),
        );
        expect(consentMode[0]).toEqual([
          'consent',
          'default',
          expect.objectContaining({ analytics_storage: 'denied', ad_storage: 'denied' }),
        ]);
        expect(consentMode[1]).toEqual([
          'consent',
          'update',
          expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'granted' }),
        ]);
      } else {
        expect(gtm).toEqual([]);
      }

      // Withdrawal is as easy: footer → preferences → switch analytics off.
      await page.getByRole('button', { name: t.settings }).click();
      const dialog = page.getByRole('dialog', { name: t.preferences });
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(page);
      const analytics = dialog.getByRole('switch', { name: t.analytics });
      await expect(analytics).toBeChecked();
      await analytics.click();
      await dialog.getByRole('button', { name: t.saveChoice }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await consentCookie(page))?.analytics).toBe(false);
      expect(await consentCookie(page)).toMatchObject({ ads: true });
      expect(errors).toEqual([]);
    });
  });

  test(`privacy centre: consents, export, correction, deletion (${locale})`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    const email = uniqueEmail(`privacy-${locale}`);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
    const signUp = await page.request.post('/api/auth/sign-up/email', {
      headers: { origin: new URL(baseURL!).origin },
      data: { name: 'E2E Riêng Tư', email, password: PASSWORD, locale, callbackURL: privacyCenter },
    });
    expect(signUp.ok(), await signUp.text()).toBe(true);
    await page.goto(await authEmailLink(email, 'verify_email'));
    await page.goto(privacyCenter);
    await expect(page.getByRole('heading', { level: 1, name: t.centerTitle })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    // Consents: marketing e-mail on → one appended row, shown in the history.
    await page.getByRole('switch', { name: t.marketingEmail }).click();
    await page.getByRole('button', { name: t.saveConsents }).click();
    await expect(page.getByText(t.consentsSaved)).toBeVisible();
    await expect
      .poll(async () => (await userConsents(email)).filter((c) => c.purpose === 'marketing_email'))
      .toEqual([{ purpose: 'marketing_email', granted: true, source: 'privacy_center' }]);
    await page.reload();
    await expect(page.getByRole('switch', { name: t.marketingEmail })).toBeChecked();

    // Export: request → (worker completes it) → download from the account.
    await page.getByRole('button', { name: t.requestCopy }).click();
    await expect(page.getByText(t.exportSent).first()).toBeVisible();
    await expect(
      page.getByTestId('privacy-request-row').filter({ hasText: t.exportType }),
    ).toBeVisible();
    const [exportRequest] = await privacyRequestsFor(email);
    expect(exportRequest).toMatchObject({ type: 'export', status: 'received' });
    await completeExport(exportRequest!.id);
    await page.reload();
    const download = page.getByRole('link', { name: t.download });
    await expect(download).toBeVisible();
    const response = await page.request.get((await download.getAttribute('href'))!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('attachment');
    const data = await response.json();
    expect(data).toMatchObject({ format: 'perfume-store.personal-data.v1', subject: { email } });
    // Someone else (no session, no signature) gets nothing.
    const anonymous = await page.context().browser()!.newContext();
    const denied = await anonymous.request.get(
      new URL((await download.getAttribute('href'))!, page.url()).toString(),
    );
    expect(denied.status()).toBe(404);
    await anonymous.close();

    // Correction.
    await page.getByLabel(t.correctionLabel).fill('Tên trên đơn hàng gần nhất bị sai chính tả.');
    await page.getByRole('button', { name: t.sendRequest, exact: true }).click();
    await expect(
      page.getByTestId('privacy-request-row').filter({ hasText: t.correctType }),
    ).toBeVisible();

    // Deletion: explicit acknowledgement before the request can be sent.
    await page.getByRole('button', { name: t.requestDelete }).click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: t.submitDelete });
    await expect(submit).toBeDisabled();
    await expectNoAxeViolations(page);
    await dialog.getByRole('checkbox', { name: t.understood }).check();
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId('privacy-request-row').filter({ hasText: t.deleteType }),
    ).toBeVisible();
    expect((await privacyRequestsFor(email)).map((r) => r.type)).toEqual([
      'export',
      'correct',
      'delete',
    ]);
    // Stacked toasts slide in from the edge; measure the page once they are gone.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test(`guest request: e-mail confirmation, then filed (${locale})`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const email = uniqueEmail(`guest-${locale}`);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
    await page.goto(guestForm);
    await expect(page.getByRole('heading', { level: 1, name: t.guestTitle })).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.getByLabel(t.email, { exact: true }).fill(email);
    await page.getByRole('radio', { name: new RegExp(t.withdraw) }).check();
    await page.getByRole('button', { name: t.sendRequest, exact: true }).click();
    await expect(page.getByText(t.guestSent)).toBeVisible();
    expect(await privacyRequestsFor(email)).toEqual([]);

    const link = new URL(await verificationLink(email));
    await page.goto(`${link.pathname}${link.search}`);
    await expect(page.getByRole('heading', { level: 1, name: t.confirmTitle })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: t.confirm }).click();
    await expect(page.getByText(t.confirmDone)).toBeVisible();
    expect(await privacyRequestsFor(email)).toEqual([
      expect.objectContaining({ type: 'withdraw_consent', status: 'completed' }),
    ]);

    // A tampered link is refused.
    await page.goto(`${link.pathname}?token=${link.searchParams.get('token')}x`);
    await expect(page.getByRole('heading', { level: 1, name: t.invalidTitle })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
