import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';

import { authEmailLink, testIp, uniqueEmail } from './helpers/account';
import {
  deleteReviewOrders,
  insertDeliveredOrder,
  insertInvitation,
  reviewProduct,
  reviewRows,
  type ReviewProduct,
} from './helpers/reviews';

/*
 * Reviews & wishlist on the storefront (M3, ADR-0008): guest review through the one-time
 * e-mailed link, member review from the account, wishlist heart (guest → sign-in → back to the
 * product) and the account wishlist. vi and en, desktop and mobile. Orders are inserted as
 * delivered fixtures and removed afterwards (reviews and links cascade); the reviews written
 * here stay pending, so product pages of other specs are unchanged.
 */

const expect = baseExpect.configure({ timeout: 15_000 });
const PASSWORD = 'E2e-review-pass-1';

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

const flows = [
  {
    locale: 'vi' as const,
    review: (token: string) => `/danh-gia/${token}`,
    product: (p: ReviewProduct) => `/san-pham/${p.viSlug}`,
    signUp: '/dang-ky',
    account: '/tai-khoan',
    wishlist: '/tai-khoan/yeu-thich',
    t: {
      reviewTitle: (name: string) => `Đánh giá ${name}`,
      starLabel: '4 sao',
      longevity: 'Lâu',
      body: 'Cảm nhận của bạn',
      name: 'Tên hiển thị',
      submit: 'Gửi đánh giá',
      tooShort: 'Hãy viết thêm một chút (tối thiểu 20 ký tự).',
      ratingRequired: 'Vui lòng chọn số sao.',
      thanks: 'Cảm ơn bạn đã đánh giá',
      used: 'Bạn đã đánh giá sản phẩm này',
      invalid: 'Liên kết không hợp lệ',
      expired: 'Liên kết đã hết hạn',
      reviewBody: 'Hương hổ phách ấm, rất hợp buổi tối mùa đông. Lưu hương lâu.',
      signUpName: 'Họ và tên',
      email: 'Email',
      password: 'Mật khẩu',
      createAccount: 'Tạo tài khoản',
      checkEmail: 'Hãy kiểm tra hộp thư',
      signInTitle: 'Đăng nhập',
      signInSubmit: 'Đăng nhập',
      save: (name: string) => `Lưu ${name} vào danh sách yêu thích`,
      signInToSave: (name: string) => `Đăng nhập để lưu ${name} vào danh sách yêu thích`,
      added: (name: string) => `Đã thêm ${name} vào danh sách yêu thích.`,
      wishlistNav: 'Yêu thích',
      wishlistTitle: 'Danh sách yêu thích',
      wishlistEmpty: 'Chưa có sản phẩm yêu thích',
      reviewsNav: 'Đánh giá',
      write: 'Viết đánh giá',
      submitted: 'Đã gửi đánh giá. Đánh giá sẽ hiển thị sau khi được kiểm duyệt.',
      pending: 'Chờ duyệt',
      nothingToWrite: /Chưa có sản phẩm nào cần đánh giá/,
      reviewsSection: 'Đánh giá của khách hàng',
      noReviews: 'Chưa có đánh giá',
    },
  },
  {
    locale: 'en' as const,
    review: (token: string) => `/en/review/${token}`,
    product: (p: ReviewProduct) => `/en/products/${p.enSlug}`,
    signUp: '/en/sign-up',
    account: '/en/account',
    wishlist: '/en/account/wishlist',
    t: {
      reviewTitle: (name: string) => `Review ${name}`,
      starLabel: '4 stars',
      longevity: 'Long',
      body: 'Your review',
      name: 'Display name',
      submit: 'Submit review',
      tooShort: 'Please write a little more (at least 20 characters).',
      ratingRequired: 'Please choose a star rating.',
      thanks: 'Thank you for your review',
      used: 'You have already reviewed this product',
      invalid: 'This link is not valid',
      expired: 'This link has expired',
      reviewBody: 'Warm amber, perfect for winter evenings. It lasts all day long.',
      signUpName: 'Full name',
      email: 'Email',
      password: 'Password',
      createAccount: 'Create account',
      checkEmail: 'Check your inbox',
      signInTitle: 'Sign in',
      signInSubmit: 'Sign in',
      save: (name: string) => `Save ${name} to your wishlist`,
      signInToSave: (name: string) => `Sign in to save ${name} to your wishlist`,
      added: (name: string) => `${name} saved to your wishlist.`,
      wishlistNav: 'Wishlist',
      wishlistTitle: 'Wishlist',
      wishlistEmpty: 'Your wishlist is empty',
      reviewsNav: 'Reviews',
      write: 'Write a review',
      submitted: 'Review sent. It will appear once it has been moderated.',
      pending: 'Awaiting moderation',
      nothingToWrite: /Nothing to review yet/,
      reviewsSection: 'Customer reviews',
      noReviews: 'No reviews yet',
    },
  },
];

const orderIds: string[] = [];
const emails: string[] = [];

test.beforeEach(async ({ context }) => {
  // Own rate-limit bucket per test (sign-up, review submissions), like distinct visitors.
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
});

test.afterAll(async () => {
  await deleteReviewOrders(orderIds, emails);
});

for (const flow of flows) {
  const { t } = flow;

  test(`guest reviews a delivered purchase through the e-mailed link (${flow.locale})`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectConsoleErrors(page);
    const product = await reviewProduct(0);
    const email = uniqueEmail(`review-guest-${flow.locale}`);
    const order = await insertDeliveredOrder({ productId: product.id, locale: flow.locale, email });
    orderIds.push(order.orderId);
    const token = await insertInvitation({ orderItemId: order.orderItemId, email });

    await page.goto(flow.review(token));
    await expect(
      page.getByRole('heading', { level: 1, name: t.reviewTitle(product.name) }),
    ).toBeVisible();
    await expect(page.getByLabel(t.name)).toHaveValue('Hương');
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    // Validation: stars required, body at least 20 characters (translated messages).
    await page.getByLabel(t.body).fill('Thơm');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(t.ratingRequired)).toBeVisible();
    await expect(page.getByText(t.tooShort)).toBeVisible();
    await expectNoAxeViolations(page);

    // Keyboard: the star radios and the score chips are native inputs.
    await page.getByRole('radio', { name: t.starLabel, exact: true }).check({ force: true });
    await page.getByRole('radio', { name: t.longevity, exact: true }).check({ force: true });
    await page.getByLabel(t.body).fill(t.reviewBody);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByRole('heading', { name: t.thanks })).toBeVisible();
    await expect
      .poll(async () => reviewRows(order.orderItemId))
      .toEqual([{ status: 'pending', rating: 4, locale: flow.locale, user_id: null }]);

    // One-time link: a second visit says it was used.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: t.used })).toBeVisible();
    await expectNoAxeViolations(page);

    // Unknown and expired links.
    await page.goto(flow.review('x'.repeat(43)));
    await expect(page.getByRole('heading', { level: 1, name: t.invalid })).toBeVisible();
    const expired = await insertDeliveredOrder({
      productId: product.id,
      locale: flow.locale,
      email,
    });
    orderIds.push(expired.orderId);
    const old = await insertInvitation({
      orderItemId: expired.orderItemId,
      email,
      expiresInDays: -1,
    });
    await page.goto(flow.review(old));
    await expect(page.getByRole('heading', { level: 1, name: t.expired })).toBeVisible();
    // Review links are never indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(errors).toEqual([]);
  });

  test(`member: wishlist from the product page and account, review from the account (${flow.locale})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    const product = await reviewProduct(0);
    const email = uniqueEmail(`review-member-${flow.locale}`);
    emails.push(email);

    // Sign up → confirm → signed in; then drop the session to start as a guest.
    await page.goto(flow.signUp);
    await page.getByLabel(t.signUpName).fill('E2E Review Hương');
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.createAccount }).click();
    await expect(page.getByRole('heading', { name: t.checkEmail })).toBeVisible();
    await page.goto(await authEmailLink(email, 'verify_email'));
    await expect(page).toHaveURL(new RegExp(`${flow.account}$`));
    await page.context().clearCookies();

    // Guest presses the heart → sign-in → back on the product.
    await page.goto(flow.product(product));
    await expect(page.getByRole('heading', { level: 2, name: t.reviewsSection })).toBeVisible();
    await expect(page.getByText(t.noReviews)).toBeVisible();
    const guestHeart = page.getByRole('button', { name: t.signInToSave(product.name) });
    await expect(guestHeart.first()).toBeEnabled();
    await expectNoAxeViolations(page);
    await guestHeart.first().click();
    await expect(page.getByRole('heading', { level: 1, name: t.signInTitle })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('next')).toBe(
      new URL(flow.product(product), page.url()).pathname,
    );
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.signInSubmit, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${flow.product(product)}$`));

    // Member toggles the heart in place.
    const heart = page
      .locator('main')
      .getByRole('button', { name: t.save(product.name) })
      .first();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await heart.click();
    await expect(page.getByText(t.added(product.name))).toBeVisible();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations(page);

    // Account wishlist shows it; the card's heart removes it (empty state).
    await page.goto(flow.wishlist);
    await expect(page.getByRole('heading', { level: 1, name: t.wishlistTitle })).toBeVisible();
    const card = page.getByTestId('product-card').filter({ hasText: product.name });
    await expect(card).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
    await card.getByRole('button', { name: t.save(product.name) }).click();
    await expect(page.getByRole('heading', { name: t.wishlistEmpty })).toBeVisible();

    // Reviews to write: a delivered order of this member → review from the account dialog.
    const order = await insertDeliveredOrder({
      productId: product.id,
      locale: flow.locale,
      email,
      userEmail: email,
    });
    orderIds.push(order.orderId);
    await page
      .getByRole('navigation', { name: /Tài khoản|Account/ })
      .getByRole('link', { name: t.reviewsNav, exact: true })
      .click();
    const toWrite = page.getByTestId('reviews-to-write');
    await expect(toWrite.getByText(product.name)).toBeVisible();
    await expectNoAxeViolations(page);
    await toWrite.getByRole('button', { name: t.write }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(t.name)).toHaveValue('Hương');
    await dialog.getByRole('radio', { name: t.starLabel, exact: true }).check({ force: true });
    await dialog.getByLabel(t.body).fill(t.reviewBody);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(t.submitted)).toBeVisible();
    await expect(page.getByText(t.nothingToWrite)).toBeVisible();
    await expect(page.getByTestId('reviews-written').getByText(t.pending)).toBeVisible();
    await expect
      .poll(async () => (await reviewRows(order.orderItemId)).map((r) => r.status))
      .toEqual(['pending']);
    expect(errors).toEqual([]);
  });
}
