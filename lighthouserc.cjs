/**
 * Lighthouse CI (ARCHITECTURE.md §14.1 "Measurement"): home, listing, PDP, cart and checkout
 * in vi + en against the production build (`node scripts/start-standalone.mjs`), seeded with
 * the demo catalogue. Runs on every pull request (.github/workflows/lighthouse.yml), once per
 * preset: LH_PRESET=mobile (default; Lighthouse's Moto G Power, slow 4G, 4x CPU) or desktop.
 *
 * Each URL is measured 3 times and every assertion uses the median of the 3 runs, so one noisy
 * run cannot fail (or pass) the job.
 *
 * Budgets (§14): Performance ≥ 0.9 on home/listing/PDP (error), on cart/checkout too (warn:
 * noindex and per-visitor); LCP < 2.5 s, CLS < 0.1; accessibility ≥ 0.95; best practices ≥ 0.9;
 * SEO ≥ 0.9 on indexable pages (cart/checkout are noindex on purpose, so no SEO assertion).
 * Relaxed for runner variance: TBT (the lab proxy for INP), the only CPU-bound budget, keeps
 * §14's 200 ms but as a warning. On GitHub runners (mobile, median of 3) the same commit
 * measured 54, 158 and 372 ms on checkout and 118, 280 and 340 ms on the listing in three
 * workflow runs, so a hard TBT limit would fail at random. The Performance score, in which TBT
 * weighs 30%, stays an error at 0.9 and absorbs that noise (listings 92–99, others 91–100).
 * Desktop TBT is 0 ms. Make TBT an error again once the listing hydrates less.
 *
 * Measured as a first visit (no cookies except the seeded cart): the cookie banner is shown,
 * as for every new visitor. Home/listing stream their request-time metadata (§14.1), which
 * Lighthouse's "meta-description" audit does not see; crawlers get it in <head>
 * (`htmlLimitedBots` in next.config.ts), so SEO there is 0.91–0.92 by design.
 *
 * Env: LH_BASE_URL (default http://localhost:3200), LH_CART_TOKEN (a seeded guest cart,
 * see load/lighthouse/seed-cart.mjs) so cart/checkout are measured with one item,
 * LH_PRODUCT_SLUG, LH_PRESET, CHROME_PATH (the runner's Chrome). Not `LHCI_*`: LHCI reads
 * every LHCI_<NAME> variable as its own --<name> option (LHCI_PRESET broke `lhci assert`).
 */
const base = (process.env.LH_BASE_URL ?? 'http://localhost:3200').replace(/\/+$/, '');
const pdp = process.env.LH_PRODUCT_SLUG ?? 'maison-lumiere-cedre-nocturne-edt';
const preset = process.env.LH_PRESET === 'desktop' ? 'desktop' : 'mobile';

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
  'total-blocking-time': median('warn', { maxNumericValue: 200 }),
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
        ...(process.env.LH_CART_TOKEN
          ? {
              extraHeaders: JSON.stringify({ Cookie: `cart_token=${process.env.LH_CART_TOKEN}` }),
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
