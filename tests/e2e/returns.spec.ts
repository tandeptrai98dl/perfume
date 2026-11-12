import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';

import { authEmailLink, testIp, uniqueEmail } from './helpers/account';
import { accessToken } from './helpers/payment-orders';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  deleteReturnOrders,
  E2E_MEDIA_DIR,
  insertReturnOrder,
  orderState,
  testPhoto,
} from './helpers/returns';

/*
 * Customer return requests (ADR-0017, §10.5): Vietnamese guest through the signed order link
 * (unopened, change of mind, part of the units) and English member from the account order page
 * (defective, refund). Desktop and mobile. Fixtures are delivered orders inserted in the
 * database and removed afterwards; the worker does not run in E2E, so the e-mails are checked
 * as queued `return.notify` jobs.
 */

const expect = baseExpect.configure({ timeout: 15_000 });
const PASSWORD = 'E2e-return-pass-1';

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

const created: string[] = [];

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': testIp() });
});

test.afterAll(async () => {
  await deleteReturnOrders(created);
});

test('guest returns part of an order through the e-mail link (vi)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const order = await insertReturnOrder({ locale: 'vi', email: uniqueEmail('return-vi') });
  created.push(order.id);

  await page.goto(`/tra-cuu-don-hang?code=${order.code}&t=${accessToken(order.code)}`);
  const section = page.getByRole('region', { name: 'Đổi trả hàng' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('Bạn có thể gửi yêu cầu trả hàng đến hết');
  await expect(section.getByRole('link', { name: 'Xem chính sách đổi trả' })).toHaveAttribute(
    'href',
    '/chinh-sach/doi-tra',
  );

  // Keyboard: open the form with Enter.
  await section.getByRole('button', { name: 'Yêu cầu trả hàng' }).focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: `Yêu cầu trả hàng cho đơn ${order.code}` });
  await expect(form).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  // The only line is preselected with every unit; return one of the two.
  await expect(
    form.getByRole('checkbox', { name: `${order.productName} 100 ml (đã mua 2)`, exact: true }),
  ).toBeChecked();
  await form.getByLabel(`Số lượng trả: ${order.productName} 100 ml`).fill('1');

  // Missing reason → field error, nothing sent.
  await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await expect(form.getByText('Chọn lý do trả hàng.')).toBeVisible();

  await form.getByRole('radio', { name: 'Đổi ý (sản phẩm chưa mở, còn nguyên seal)' }).check();
  await expect(form.getByText(/phí gửi trả do bạn chịu/)).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Đổi sản phẩm mới' })).toHaveCount(0);
  await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await expect(form.getByText('Hàng đổi ý chỉ được trả khi còn nguyên seal.')).toBeVisible();
  await form
    .getByRole('checkbox', { name: 'Tôi xác nhận sản phẩm chưa mở và còn nguyên seal.' })
    .check();

  // Photos: a non-image is refused in the browser; a real photo is attached.
  const photos = form.getByLabel('Ảnh sản phẩm hoặc bao bì (không bắt buộc)');
  await photos.setInputFiles({
    name: 'ghi-chu.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(form.getByText('Chỉ nhận ảnh JPEG, PNG hoặc WebP.')).toBeVisible();
  await photos.setInputFiles({
    name: 'hop-con-seal.png',
    mimeType: 'image/png',
    buffer: await testPhoto(),
  });
  await expect(form.getByRole('list', { name: 'Ảnh đã chọn' })).toContainText('hop-con-seal.png');
  await expectNoAxeViolations(page);
  await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();

  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Đã gửi yêu cầu trả hàng.' }),
  ).toBeVisible();
  await expect(section.getByRole('status')).toContainText('Đã nhận yêu cầu trả hàng');
  await expect(section).toContainText(`${order.productName} 100 ml × 1`);
  await expect(page.getByText('Yêu cầu trả hàng', { exact: true }).first()).toBeVisible();
  await expectNoAxeViolations(page);

  const state = await orderState(order.id);
  expect(state.status).toBe('return_requested');
  const requested = state.events.find((e) => e.type === 'return_requested')?.metadata as {
    photos: { key: string; mime: string }[];
  };
  expect(requested).toMatchObject({
    reason: 'unopened',
    resolution: 'refund',
    sealIntact: true,
    lines: [{ orderItemId: order.itemId, quantity: 1 }],
    photos: [{ mime: 'image/webp' }],
  });
  // Stored privately, re-encoded, and never served by the public media route.
  const key = requested.photos[0]!.key;
  expect(key).toMatch(new RegExp(`^private/returns/${order.id}/[0-9a-f-]+\\.webp$`));
  expect(existsSync(join(E2E_MEDIA_DIR, key))).toBe(true);
  expect((await page.request.get(`/api/media/${key}`)).status()).toBe(404);
  expect((await page.request.get(`/api/admin/orders/${order.id}/return-photos/x`)).status()).toBe(
    404,
  );
  await expect(section).toContainText('Đã gửi kèm 1 ảnh');
  expect(state.jobs.map((job) => job.name)).toEqual(
    expect.arrayContaining(['return.notify', 'staff.alert']),
  );
  expect(errors).toEqual([]);
});

test('member requests a refund for a defective item from the account (en)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  const email = uniqueEmail('return-en');
  await page.goto('/en/sign-up');
  await page.getByLabel('Full name').fill('E2E Return Jane');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  await page.goto(await authEmailLink(email, 'verify_email'));
  await expect(page).toHaveURL(/\/en\/account$/);

  const order = await insertReturnOrder({ locale: 'en', email, userEmail: email });
  created.push(order.id);
  await page.goto(`/en/account/orders/${order.code}`);
  const section = page.getByRole('region', { name: 'Returns' });
  await expect(section).toContainText('You can request a return until');
  await section.getByRole('button', { name: 'Request a return' }).click();
  const form = page.getByRole('form', { name: `Return request for order ${order.code}` });

  await form.getByRole('radio', { name: 'Defective product' }).check();
  await expect(form.getByRole('radio', { name: 'Refund' })).toBeChecked();
  await expect(form.getByRole('radio', { name: 'Replacement' })).toBeVisible();
  // The shop's fault needs a description.
  await form.getByLabel('Description').fill('Leaks');
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(
    form.getByText('Please describe the problem (at least 10 characters).'),
  ).toBeVisible();
  await form.getByLabel('Description').fill('The atomiser leaks when spraying.');
  const photos = form.getByLabel('Photos of the product or packaging (optional)');
  await photos.setInputFiles([
    { name: 'leak-1.png', mimeType: 'image/png', buffer: await testPhoto() },
    { name: 'leak-2.png', mimeType: 'image/png', buffer: await testPhoto(200, 400) },
  ]);
  await form.getByRole('button', { name: 'Remove photo leak-2.png' }).click();
  await expect(form.getByRole('list', { name: 'Selected photos' })).not.toContainText('leak-2.png');
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  await form.getByRole('button', { name: 'Send request' }).click();

  await expect(section.getByRole('status')).toContainText('Return request received');
  await expect(section).toContainText('Reason: Defective product');
  await expect(section).toContainText(`${order.productName} 100 ml × 2`);
  await expect(page.getByText('Return requested').first()).toBeVisible();
  await expectNoAxeViolations(page);

  const state = await orderState(order.id);
  expect(state.status).toBe('return_requested');
  const request = state.events.find((e) => e.type === 'return_requested');
  expect(request?.message).toBe('The atomiser leaks when spraying.');
  expect(request?.metadata).toMatchObject({
    reason: 'defective',
    resolution: 'refund',
    photos: [{ mime: 'image/webp' }],
  });
  await expect(section).toContainText('1 photo attached');
  expect(state.jobs.find((job) => job.name === 'return.notify')?.data).toMatchObject({
    kind: 'requested',
  });

  // One open request at a time: the form does not come back while it is pending.
  await page.reload();
  await expect(section.getByRole('button', { name: 'Request a return' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
