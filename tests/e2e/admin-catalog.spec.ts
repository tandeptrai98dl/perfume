import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';

import { createStaffWithTotp, freshTotp, type StaffAccount } from './helpers/staff';

/*
 * Admin catalogue and inventory (stream B): owner creates a bilingual brand and product with a
 * variant, publishes it and adjusts stock; an editor can edit content but not prices.
 * Admin is optimised for ≥ 1024 px, so this runs in the desktop project only.
 * Needs DATABASE_URL (the app's database) to promote the test accounts to staff.
 */

/** Server Actions + refresh round-trips; generous for cold caches and small CI machines. */
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
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function signIn(page: Page, account: StaffAccount) {
  await page.goto('/admin/login');
  await field(page, 'Email').fill(account.email);
  await field(page, 'Mật khẩu').fill(account.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await field(page, 'Mã xác thực').fill(await freshTotp(account.secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/**
 * Labelled control on the visible page. Next.js keeps recently visited routes mounted but
 * hidden (Activity), so plain getByLabel could match a field of the previous page.
 */
const field = (scope: Page | Locator, label: string) =>
  scope.getByLabel(label, { exact: true }).filter({ visible: true });

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

test.describe.serial('admin catalogue and inventory', () => {
  test.skip(({ isMobile }) => isMobile, 'Admin targets ≥ 1024 px screens and tablets');

  const run = Date.now().toString(36);
  const brandName = `E2E Maison ${run}`;
  const productName = `Hương E2E ${run}`;
  const sku = `E2E-${run}-100`.toUpperCase();
  let owner: StaffAccount;
  let editor: StaffAccount;
  let productUrl = '';

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    owner = await createStaffWithTotp(baseURL, 'owner');
    editor = await createStaffWithTotp(baseURL, 'editor');
  });

  test('owner creates a bilingual brand and product, publishes it and adjusts stock', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, owner);

    // Brand with vi + en translations.
    await page
      .getByRole('navigation', { name: 'Điều hướng quản trị' })
      .getByRole('link', { name: 'Thương hiệu', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Thương hiệu' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Thêm thương hiệu' }).click();
    await field(page, 'Tên thương hiệu').fill(brandName);
    await expect(field(page, 'Đường dẫn (slug)')).toHaveValue(`e2e-maison-${run}`);
    await choose(page, 'Trạng thái', 'Đang bán');
    await page.getByRole('tab', { name: /Tiếng Anh/ }).click();
    await page.getByRole('button', { name: 'Thêm bản tiếng Anh' }).click();
    await page.getByRole('switch', { name: 'Xuất bản bản Tiếng Anh' }).click();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(toast(page, 'Đã tạo')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/catalog\/brands\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: brandName })).toBeVisible();

    // Product draft.
    await page.goto('/admin/products/new');
    await choose(page, 'Thương hiệu', brandName);
    await choose(page, 'Nồng độ', 'Eau de Toilette');
    await field(page, 'Tên sản phẩm').fill(productName);
    await page.getByRole('button', { name: 'Tạo bản nháp' }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}/);
    productUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: productName })).toBeVisible();

    // Details in vi and en.
    await field(page, 'Mô tả ngắn').fill('Gỗ tuyết tùng và cam bergamot');
    await field(page, 'Mô tả chi tiết').fill('Một mùi hương gỗ thanh lịch cho buổi tối.');
    await page.getByRole('tab', { name: /Tiếng Anh/ }).click();
    await page.getByRole('button', { name: 'Thêm bản tiếng Anh' }).click();
    await field(page, 'Tên sản phẩm').fill(`E2E Scent ${run}`);
    await field(page, 'Mô tả ngắn').fill('Cedarwood and bergamot');
    await page.getByRole('switch', { name: 'Xuất bản bản Tiếng Anh' }).click();
    await expectNoAxeViolations(page);

    // A variant with an integer VND price.
    await page.getByRole('tab', { name: 'Biến thể & giá' }).click();
    await page.getByRole('button', { name: 'Thêm biến thể' }).click();
    await field(page, 'SKU – Biến thể 1').fill(sku);
    await field(page, 'Dung tích (ml) – Biến thể 1').fill('100');
    await field(page, 'Giá bán (đ) – Biến thể 1').fill('2500000');
    await field(page, 'Khối lượng (g) – Biến thể 1').fill('400');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(toast(page, 'Đã lưu thay đổi')).toBeVisible();
    await expect(field(page, 'SKU – Biến thể 1')).toHaveValue(sku);
    await expect(page.getByText('Có thay đổi chưa lưu')).toHaveCount(0);

    // Publish.
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    await expect(toast(page, 'Đã đổi trạng thái')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chuyển về nháp' })).toBeVisible();

    // Product list shows it with its price.
    await page.goto(`/admin/products?q=${encodeURIComponent(sku)}`);
    const row = page.getByRole('row').filter({ hasText: productName });
    await expect(row).toContainText('Đang bán');
    await expect(row).toContainText('2.500.000');
    await expectNoAxeViolations(page);

    // Stock adjustment with a required reason.
    await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
    await page
      .getByRole('button', { name: `Điều chỉnh tồn kho ${sku}` })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Điều chỉnh tồn kho' });
    await field(dialog, 'Số lượng').fill('5');
    await dialog.getByRole('button', { name: 'Lưu điều chỉnh' }).click();
    await expect(dialog.getByText('Chọn lý do điều chỉnh.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Lý do' }).click();
    await page.getByRole('option', { name: 'Nhập hàng' }).click();
    await dialog.getByRole('button', { name: 'Lưu điều chỉnh' }).click();
    await expect(toast(page, `Đã cập nhật ${sku}: thực có 5`)).toBeVisible();
    const stockRow = page
      .getByRole('table', { name: 'Tồn kho' })
      .getByRole('row')
      .filter({ hasText: sku });
    await expect(stockRow.getByRole('cell').nth(2)).toHaveText('5');
    await expectNoAxeViolations(page);

    // Movement log.
    await stockRow.getByRole('link', { name: sku }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lịch sử nhập xuất' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: sku }).first()).toContainText('+5');
    await expect(page.getByRole('row').filter({ hasText: sku }).first()).toContainText('Nhập hàng');

    expect(errors).toEqual([]);
  });

  test('editor edits content but cannot change prices or stock', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!productUrl, 'needs the product from the previous test');
    const errors = collectConsoleErrors(page);
    await signIn(page, editor);

    const nav = page.getByRole('navigation', { name: 'Điều hướng quản trị' });
    await expect(nav.getByRole('link', { name: 'Sản phẩm', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tồn kho', exact: true })).toHaveCount(0);

    await page.goto(`${productUrl}?tab=variants`);
    const price = field(page, 'Giá bán (đ) – Biến thể 1');
    await expect(price).toHaveAttribute('readonly', '');
    await expect(page.getByText(/Bạn chỉ được xem giá/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm biến thể' })).toHaveCount(0);

    // Content edits still work.
    await page.getByRole('tab', { name: 'Thông tin' }).click();
    await field(page, 'Mô tả ngắn').fill('Gỗ tuyết tùng, cam bergamot và xạ hương');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(toast(page, 'Đã lưu thay đổi')).toBeVisible();

    // Bypassing the read-only input is rejected by the server. (Switching tabs first also
    // guarantees the page is hydrated before the DOM is tampered with.)
    await page.goto(productUrl);
    await page.getByRole('tab', { name: 'Biến thể & giá' }).click();
    await expect(price).toHaveAttribute('readonly', '');
    await price.evaluate((input) => input.removeAttribute('readonly'));
    await price.fill('1000');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(toast(page, 'Bạn không có quyền sửa giá hoặc thêm biến thể.')).toBeVisible();

    await page.goto('/admin/inventory');
    await expect(page).toHaveURL(/\/admin\/forbidden$/);

    expect(errors).toEqual([]);
  });

  test('catalogue screens are keyboard reachable and accessible', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await signIn(page, owner);
    for (const path of [
      '/admin/catalog/product-lines',
      '/admin/catalog/categories',
      '/admin/catalog/categories/new',
      '/admin/catalog/collections',
      '/admin/catalog/collections/new',
      '/admin/catalog/families',
      '/admin/catalog/notes/new',
      '/admin/inventory/movements',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    }

    // Skip link and keyboard access to the sidebar.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Bỏ qua đến nội dung chính' })).toBeFocused();

    // A category in vi + en through the keyboard-friendly form.
    await page.goto('/admin/catalog/categories/new');
    await field(page, 'Tên danh mục').fill(`Danh mục E2E ${run}`);
    await page.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(toast(page, 'Đã tạo')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/catalog\/categories\/[0-9a-f-]{36}$/);

    expect(errors).toEqual([]);
  });
});
