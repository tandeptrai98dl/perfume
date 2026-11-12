import { expect as baseExpect, test } from '@playwright/test';

import {
  collectConsoleErrors,
  createStaff,
  expectNoAxeViolations,
  signInAdmin,
  toast,
} from './helpers/admin-session';
import {
  deleteReviewOrders,
  insertDeliveredOrder,
  insertPendingReview,
  productRating,
  reviewProduct,
  type ReviewProduct,
} from './helpers/reviews';
import type { StaffAccount } from './helpers/staff';

/*
 * Review moderation (M3, ADR-0008, §11.2): an Editor finds a pending verified review, replies
 * and approves it → it appears on the product page (vi and en) with "Verified purchase", the
 * reply and AggregateRating in the Product JSON-LD; unpublishing hides it again and restores
 * the product rating. Fixture orders are deleted afterwards.
 */

const expect = baseExpect.configure({ timeout: 15_000 });

test.describe.serial('admin review moderation', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36);
  const reviewer = `E2E Review ${run}`;
  const body = `Hổ phách và vani, toả hương vừa phải, giữ mùi cả ngày (${run}).`;
  const reply = `Cảm ơn bạn đã tin chọn cửa hàng (${run}).`;
  const orderIds: string[] = [];
  let editor: StaffAccount;
  let product: ReviewProduct;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(240_000);
    editor = await createStaff(testInfo.project.use.baseURL!, 'editor');
    // Another product than the storefront review spec, so its reviews never mix in.
    product = await reviewProduct(1);
    const order = await insertDeliveredOrder({
      productId: product.id,
      locale: 'vi',
      email: `e2e-admin-review-${run}@perfume.test`,
    });
    orderIds.push(order.orderId);
    await insertPendingReview({
      orderItemId: order.orderItemId,
      productId: product.id,
      reviewerName: reviewer,
      body,
      rating: 4,
      locale: 'vi',
    });
  });

  test.afterAll(async () => {
    await deleteReviewOrders(orderIds);
  });

  test('editor replies to and approves a review, then unpublishes it', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectConsoleErrors(page);
    const before = await productRating(product.id);
    await signInAdmin(page, editor);

    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Kiểm duyệt đánh giá', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kiểm duyệt đánh giá' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Chờ duyệt/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByLabel('Tìm theo sản phẩm, người đánh giá, mã đơn').fill(reviewer);
    const row = page.getByRole('row').filter({ hasText: body });
    await expect(row).toBeVisible();
    await expect(row.getByText('Chờ duyệt', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    // Reply (public once published).
    await row.getByRole('button', { name: `Phản hồi đánh giá của ${reviewer}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nội dung phản hồi').fill(reply);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Lưu phản hồi' }).click();
    await expect(toast(page, 'Đã lưu phản hồi.')).toBeVisible();
    await expect(row.getByText(reply)).toBeVisible();

    // Approve → leaves the pending queue, rating recomputed.
    await row.getByRole('button', { name: `Duyệt đánh giá của ${reviewer}` }).click();
    await expect(toast(page, 'Đã duyệt và đăng đánh giá.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: body })).toHaveCount(0);
    await expect.poll(async () => (await productRating(product.id)).count).toBe(before.count + 1);

    // Published on the product page in both locales, with JSON-LD AggregateRating.
    for (const path of [`/san-pham/${product.viSlug}`, `/en/products/${product.enSlug}`]) {
      await page.goto(path);
      const section = page.getByTestId('product-reviews');
      const item = section.getByTestId('review-item').filter({ hasText: body });
      await expect(item).toBeVisible();
      await expect(item.getByText(/Đã mua hàng|Verified purchase/)).toBeVisible();
      await expect(item.getByText(reply)).toBeVisible();
      const jsonLd = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent ?? '{}')));
      const productLd = jsonLd.find((ld) => ld['@type'] === 'Product');
      expect(productLd?.aggregateRating).toMatchObject({
        '@type': 'AggregateRating',
        reviewCount: before.count + 1,
      });
      await expectNoAxeViolations(page);
    }

    // Unpublish from the approved tab → hidden again.
    await page.goto('/admin/reviews?status=approved');
    const approved = page.getByRole('row').filter({ hasText: body });
    await expect(approved.getByText('Đã đăng', { exact: true })).toBeVisible();
    await approved.getByRole('button', { name: `Từ chối đánh giá của ${reviewer}` }).click();
    await expect(toast(page, 'Đã từ chối đánh giá.')).toBeVisible();
    await expect.poll(async () => productRating(product.id)).toEqual(before);
    await page.goto(`/san-pham/${product.viSlug}`);
    await expect(page.getByTestId('product-reviews')).toBeVisible();
    await expect(page.getByText(body)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
