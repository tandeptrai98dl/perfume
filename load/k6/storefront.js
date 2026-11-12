/*
 * k6 load test (ARCHITECTURE.md §14, §15 M3 item 3): 200 concurrent browsing users plus
 * 20 checkouts per minute paid through the VNPay sandbox simulator. See load/k6/README.md.
 *
 *   k6 run -e BASE_URL=https://staging.example.vn load/k6/storefront.js
 *
 * Thresholds follow §14: cached pages p95 < 500 ms under load (TTFB target 200 ms unloaded),
 * search suggestions p95 < 300 ms, < 1% errors, every checkout ends on "Payment received".
 */
import { browser } from 'k6/browser';
import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:3200').replace(/\/+$/, '');
const DURATION = __ENV.DURATION || '10m';
const BROWSE_VUS = Number(__ENV.BROWSE_VUS || 200);
const CHECKOUTS_PER_MINUTE = Number(__ENV.CHECKOUTS_PER_MINUTE || 20);
/** Product with plenty of stock on the target (each checkout buys one unit). */
const PRODUCT = __ENV.PRODUCT_SLUG || 'maison-lumiere-cedre-nocturne-edt';

/** "10m" / "90s" / "1h" → minutes. */
function minutes(duration) {
  const match = /^(\d+)(s|m|h)$/.exec(duration);
  if (!match) throw new Error(`DURATION must look like 10m, 90s or 1h, got ${duration}`);
  const value = Number(match[1]);
  return match[2] === 'h' ? value * 60 : match[2] === 'm' ? value : value / 60;
}
/** At least 95% of the scheduled checkouts must end paid. */
const EXPECTED_PAID = Math.floor(CHECKOUTS_PER_MINUTE * minutes(DURATION) * 0.95);

const placedOrders = new Counter('checkout_orders_paid');
const checkoutDuration = new Trend('checkout_place_to_paid_ms', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '1m', target: BROWSE_VUS },
        { duration: DURATION, target: BROWSE_VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    checkout: {
      executor: 'constant-arrival-rate',
      exec: 'checkout',
      rate: CHECKOUTS_PER_MINUTE,
      timeUnit: '1m',
      duration: DURATION,
      startTime: '1m',
      preAllocatedVUs: 5,
      maxVUs: 15,
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:page}': ['p(95)<500'],
    'http_req_duration{kind:suggest}': ['p(95)<300'],
    checks: ['rate>0.99'],
    checkout_orders_paid: [`count>=${EXPECTED_PAID}`],
    browser_web_vital_lcp: ['p(75)<2500'],
    browser_web_vital_cls: ['p(75)<0.1'],
  },
};

/** Each VU gets its own client IP (the target trusts x-forwarded-for, see README). */
function vuIp() {
  const n = (__VU * 7919 + 13) % 65_000;
  return `10.${Math.floor(n / 250) % 250}.${n % 250}.${(__VU % 250) + 1}`;
}

const browsePaths = [
  { path: '/', weight: 3 },
  { path: '/en', weight: 1 },
  { path: '/nuoc-hoa', weight: 3 },
  { path: '/en/perfumes', weight: 1 },
  { path: '/nuoc-hoa?sort=price_asc', weight: 1 },
  { path: `/san-pham/${PRODUCT}`, weight: 4 },
  { path: `/en/products/${PRODUCT}`, weight: 2 },
  { path: '/thuong-hieu', weight: 1 },
];
const totalWeight = browsePaths.reduce((sum, entry) => sum + entry.weight, 0);
const queries = ['dior', 'cedre', 'hoa', 'amber', 'nuoc hoa nam', 'rose'];

function pickPath() {
  let roll = Math.random() * totalWeight;
  for (const entry of browsePaths) {
    roll -= entry.weight;
    if (roll <= 0) return entry.path;
  }
  return '/';
}

export function browse() {
  const headers = { 'x-forwarded-for': vuIp(), 'accept-language': 'vi,en;q=0.8' };
  group('page', () => {
    const response = http.get(`${BASE}${pickPath()}`, { headers, tags: { kind: 'page' } });
    check(response, { 'page 200': (r) => r.status === 200 });
  });
  if (Math.random() < 0.3) {
    group('suggest', () => {
      const q = queries[Math.floor(Math.random() * queries.length)];
      const response = http.get(
        `${BASE}/api/search/suggestions?locale=vi&q=${encodeURIComponent(q)}`,
        { headers, tags: { kind: 'suggest' } },
      );
      check(response, { 'suggest 200': (r) => r.status === 200 });
    });
  }
  sleep(1 + Math.random() * 4);
}

async function pick(page, combobox, search, option) {
  await page.getByRole('combobox', { name: combobox }).click();
  await page.keyboard.type(search);
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function checkout() {
  const context = await browser.newContext({
    locale: 'en-GB',
    extraHTTPHeaders: { 'x-forwarded-for': `10.250.${__VU % 250}.${__ITER % 250}` },
  });
  const page = await context.newPage();
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  try {
    await page.goto(`${BASE}/en/products/${PRODUCT}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('dialog', { name: 'Your cart' }).waitFor();

    await page.goto(`${BASE}/en/checkout`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`k6+${id}@example.com`);
    await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('0912345678');
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Load Test');
    await pick(page, 'Province / city', 'Hồ Chí Minh', 'Thanh pho Ho Chi Minh');
    await pick(page, 'Ward / commune', 'Bến Thành', 'Phuong Ben Thanh');
    await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('12 Le Loi');
    await page.getByRole('radio', { name: /Standard delivery/ }).click();
    await page.getByRole('radio', { name: /^VNPay/ }).click();
    await page.getByRole('checkbox', { name: /Terms of sale/ }).click();
    await page.getByRole('checkbox', { name: /Privacy policy/ }).click();

    const started = Date.now();
    // VNPay → sandbox simulator (sends the signed IPN) → result page polls until paid.
    await page.getByRole('button', { name: 'Place order and pay', exact: true }).click();
    await page.waitForURL(/\/en\/checkout\/result\?/, { timeout: 30_000 });
    await page.getByText('Payment received').waitFor({ timeout: 30_000 });
    checkoutDuration.add(Date.now() - started);
    placedOrders.add(1);
    check(page, { 'checkout paid': () => true });
  } catch (error) {
    check(page, { 'checkout paid': () => false });
    console.error(`checkout ${id} failed: ${error}`);
  } finally {
    await page.close();
    await context.close();
  }
}
