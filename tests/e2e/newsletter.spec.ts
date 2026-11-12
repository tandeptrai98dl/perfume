import { test } from '@playwright/test';

import {
  cleanupNewsletter,
  confirmationLink,
  newsletterConsents,
  newsletterEmail,
  newsletterIp,
  oneClickPath,
  queuedConfirmations,
  subscriberRow,
  unsubscribePath,
} from './helpers/newsletter';
import { checkPage, collectConsoleErrors, expect } from './helpers/purchase';

/*
 * Newsletter double opt-in (§2 Marketing, M3 wave 2): footer/home form → e-mailed signed link
 * → explicit "Confirm" → subscribed with a `marketing_email` consent → signed unsubscribe page
 * (one button) and the RFC 8058 one-click endpoint. vi and en, 1280/768/375.
 * No worker runs during E2E: the e-mails are read from the outbox (pgboss.job).
 */

const FLOWS = {
  vi: {
    locale: 'vi' as const,
    home: '/',
    email: 'Địa chỉ e-mail nhận bản tin',
    consent: /Tôi đồng ý nhận tin tức/,
    submit: 'Đăng ký',
    sent: /Sắp xong: hãy kiểm tra hộp thư/,
    consentRequired: 'Vui lòng đánh dấu ô đồng ý nhận e-mail từ chúng tôi.',
    confirmPath: /\/ban-tin\/xac-nhan\?token=/,
    confirmTitle: 'Xác nhận đăng ký bản tin',
    confirm: 'Xác nhận đăng ký',
    confirmed: /bạn đã đăng ký thành công/,
    unsubscribeTitle: 'Hủy đăng ký bản tin',
    unsubscribe: 'Hủy đăng ký',
    unsubscribed: /Bạn đã hủy đăng ký/,
    invalid: 'Liên kết không hợp lệ hoặc đã hết hạn',
  },
  en: {
    locale: 'en' as const,
    home: '/en',
    email: 'Newsletter e-mail address',
    consent: /I agree to receive news/,
    submit: 'Subscribe',
    sent: /Almost done: check your inbox/,
    consentRequired: 'Tick the box to agree to receive our e-mails.',
    confirmPath: /\/en\/newsletter\/confirm\?token=/,
    confirmTitle: 'Confirm your subscription',
    confirm: 'Confirm subscription',
    confirmed: /you are subscribed/,
    unsubscribeTitle: 'Unsubscribe from the newsletter',
    unsubscribe: 'Unsubscribe',
    unsubscribed: /You are unsubscribed/,
    invalid: 'This link is invalid or has expired',
  },
} as const;

for (const flow of Object.values(FLOWS)) {
  test.describe(`newsletter (${flow.locale})`, () => {
    let email: string;

    test.beforeEach(async ({ context }) => {
      email = newsletterEmail(flow.locale);
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': newsletterIp() });
    });

    test.afterEach(async () => {
      await cleanupNewsletter(email);
    });

    test('footer sign-up → confirm link → subscribed → unsubscribe page', async ({
      page,
      request,
      isMobile,
    }) => {
      test.setTimeout(90_000);
      const errors = collectConsoleErrors(page);
      await page.goto(flow.home);
      await page.waitForLoadState('networkidle');
      const form = page.getByTestId('newsletter-footer');
      await form.scrollIntoViewIfNeeded();

      // The consent box is unticked and required.
      await form.getByRole('textbox', { name: flow.email }).fill(email);
      await form.getByRole('button', { name: flow.submit }).click();
      await expect(form.getByText(flow.consentRequired)).toBeVisible();
      expect(await queuedConfirmations(email)).toBe(0);

      await form.getByRole('checkbox', { name: flow.consent }).click();
      await form.getByRole('button', { name: flow.submit }).click();
      await expect(form.getByText(flow.sent)).toBeVisible();

      // Nothing is stored before the link is confirmed.
      const link = await confirmationLink(email);
      expect(await subscriberRow(email)).toBeNull();
      expect(await newsletterConsents(email)).toEqual([]);

      await page.goto(link);
      await expect(page).toHaveURL(flow.confirmPath);
      await expect(page.getByRole('heading', { level: 1, name: flow.confirmTitle })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await checkPage(page, isMobile);
      // Opening the link alone subscribes nobody (mail scanners follow links).
      expect(await subscriberRow(email)).toBeNull();
      await page.getByRole('button', { name: flow.confirm }).click();
      await expect(page.getByText(flow.confirmed)).toBeVisible();

      const row = await subscriberRow(email);
      expect(row).toMatchObject({ status: 'subscribed', locale: flow.locale, source: 'footer' });
      const consents = await newsletterConsents(email);
      expect(consents).toEqual([
        { id: row!.consent_id, granted: true, source: 'newsletter_footer' },
      ]);

      // Unsubscribe page of the welcome e-mail: masked address, one button.
      await page.goto(unsubscribePath(flow.locale, row!.id));
      await expect(
        page.getByRole('heading', { level: 1, name: flow.unsubscribeTitle }),
      ).toBeVisible();
      await expect(page.getByText(/^e\*\*\*@perfume\.test$/)).toBeVisible();
      await checkPage(page, isMobile);
      await page.getByRole('button', { name: flow.unsubscribe, exact: true }).click();
      await expect(page.getByText(flow.unsubscribed)).toBeVisible();
      expect((await subscriberRow(email))!.status).toBe('unsubscribed');
      expect((await newsletterConsents(email)).map((c) => [c.granted, c.source])).toEqual([
        [true, 'newsletter_footer'],
        [false, 'newsletter_unsubscribe'],
      ]);

      // RFC 8058 one-click: idempotent 200 for a signed link, 400 for a forged one.
      expect((await request.post(oneClickPath(row!.id))).status()).toBe(200);
      const forged = oneClickPath(row!.id).replace(/t=.{4}/, 't=AAAA');
      expect((await request.post(forged)).status()).toBe(400);
      expect(await newsletterConsents(email)).toHaveLength(2);
      expect(errors).toEqual([]);
    });

    test('home sign-up, then the mail client one-click unsubscribe', async ({ page, request }) => {
      await page.goto(flow.home);
      await page.waitForLoadState('networkidle');
      const form = page.getByTestId('newsletter-home');
      await form.getByRole('textbox', { name: flow.email }).fill(email);
      await form.getByRole('checkbox', { name: flow.consent }).click();
      await form.getByRole('button', { name: flow.submit }).click();
      await expect(form.getByText(flow.sent)).toBeVisible();

      await page.goto(await confirmationLink(email));
      await page.getByRole('button', { name: flow.confirm }).click();
      await expect(page.getByText(flow.confirmed)).toBeVisible();
      const row = await subscriberRow(email);
      expect(row).toMatchObject({ status: 'subscribed', source: 'home' });

      expect((await request.post(oneClickPath(row!.id))).status()).toBe(200);
      expect((await subscriberRow(email))!.status).toBe('unsubscribed');
      expect((await newsletterConsents(email)).map((c) => c.source)).toEqual([
        'newsletter_home',
        'newsletter_one_click',
      ]);
    });

    test('a tampered confirmation link is refused', async ({ page }) => {
      await page.goto(
        `${flow.locale === 'vi' ? '/ban-tin/xac-nhan' : '/en/newsletter/confirm'}?token=abc.def`,
      );
      await expect(page.getByRole('heading', { level: 1, name: flow.invalid })).toBeVisible();
      await expect(page.getByRole('button', { name: flow.confirm })).toHaveCount(0);
    });
  });
}
