/**
 * Lighthouse CI (ARCHITECTURE.md §14.1 "Measurement"): home, listing, PDP, cart and checkout
 * in vi + en against the production build (`node scripts/start-standalone.mjs`), seeded with
 * the demo catalogue. Runs on every pull request (.github/workflows/lighthouse.yml), once per
 * preset: LHCI_PRESET=mobile (default; Lighthouse's Moto G Power, slow 4G, 4x CPU) or desktop.
 *
 * Each URL is measured 3 times and every assertion uses the median of the 3 runs, so one noisy
 * run cannot fail (or pass) the job.
 *
 * Budgets (§14): Performance ≥ 0.9 on home/listing/PDP (error), on cart/checkout too (warn:
 * noindex and per-visitor); LCP < 2.5 s, CLS < 0.1; accessibility ≥ 0.95; best practices ≥ 0.9;
 * SEO ≥ 0.9 on indexable pages (cart/checkout are noindex on purpose, so no SEO assertion).
 * Runner variance: TBT (the lab proxy for INP) is the only CPU-bound budget; it is asserted at
 * 300 ms instead of §14's 200 ms because shared GitHub runners vary by ±100 ms between runs,
 * and the Performance score (which weighs TBT at 30%) still has to reach 0.9.
 *
 * Measured as a first visit (no cookies except the seeded cart): the cookie banner is shown,
 * as for every new visitor. Home/listing stream their request-time metadata (§14.1), which
 * Lighthouse's "meta-description" audit does not see; crawlers get it in <head>
 * (`htmlLimitedBots` in next.config.ts), so SEO there is 0.91–0.92 by design.
 *
 * Env: LHCI_BASE_URL (default http://localhost:3200), LHCI_CART_TOKEN (a seeded guest cart,
 * see load/lighthouse/seed-cart.mjs) so cart/checkout are measured with one item,
 * LHCI_PRODUCT_SLUG, LHCI_PRESET, CHROME_PATH (the runner's Chrome).
 */
const base = (process.env.LHCI_BASE_URL ?? 'http://localhost:3200').replace(/\/+$/, '');
const pdp = process.env.LHCI_PRODUCT_SLUG ?? 'maison-lumiere-cedre-nocturne-edt';
const preset = process.env.LHCI_PRESET === 'desktop' ? 'desktop' : 'mobile';

const indexable = [
  '/',
  '/en',
  '/nuoc-hoa',
  '/en/perfumes',
  `/san-pham/${pdp}`,
  `/en/products/${pdp}`,
];
const transactional = ['/gio-hang', '/en/cart', '/thanh-toan', '/en/checkout'];

/** Median of the runs for every assertion (LHCI's default is the best run). */
const median = (level, options) => [level, { ...options, aggregationMethod: 'median' }];

const vitals = {
  'largest-contentful-paint': median('error', { maxNumericValue: 2500 }),
  'cumulative-layout-shift': median('error', { maxNumericValue: 0.1 }),
  'total-blocking-time': median('error', { maxNumericValue: 300 }),
  'categories:accessibility': median('error', { minScore: 0.95 }),
  'categories:best-practices': median('error', { minScore: 0.9 }),
};

const escape = (path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (paths) => `^${escape(base)}(${paths.map(escape).join('|')})$`;

module.exports = {
  ci: {
    collect: {
      url: [...indexable, ...transactional].map((path) => `${base}${path}`),
      numberOfRuns: 3,
      settings: {
        ...(preset === 'desktop' ? { preset: 'desktop' } : {}),
        // The CI runner's Chrome; no sandbox inside containers.
        chromeFlags: '--no-sandbox --headless=new',
        // Not part of the budgets; keeps runs shorter.
        skipAudits: ['full-page-screenshot'],
        ...(process.env.LHCI_CART_TOKEN
          ? {
              extraHeaders: JSON.stringify({ Cookie: `cart_token=${process.env.LHCI_CART_TOKEN}` }),
            }
          : {}),
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: exact(indexable),
          assertions: {
            ...vitals,
            'categories:performance': median('error', { minScore: 0.9 }),
            'categories:seo': median('error', { minScore: 0.9 }),
          },
        },
        {
          matchingUrlPattern: exact(transactional),
          assertions: {
            ...vitals,
            'categories:performance': median('warn', { minScore: 0.9 }),
          },
        },
      ],
    },
    // Reports stay in the workflow artifacts (no public upload of shop pages).
    upload: { target: 'filesystem', outputDir: `.lighthouseci/reports-${preset}` },
  },
};
