/**
 * Lighthouse CI (ARCHITECTURE.md §14.1 "Measurement"): home, listing, PDP, cart and checkout
 * in vi + en against the production build (`node scripts/start-standalone.mjs`), mobile
 * emulation (Lighthouse default: Moto G Power, slow 4G, 4x CPU throttling).
 *
 * Budgets follow §14 targets: Performance ≥ 0.9 on home/listing/PDP (warn on cart/checkout,
 * which are noindex and dynamic), LCP < 2.5 s, CLS < 0.1, TBT < 200 ms (lab proxy for INP),
 * accessibility ≥ 0.95, SEO ≥ 0.9 on indexable pages.
 *
 * Env: LHCI_BASE_URL (default http://localhost:3200), LHCI_CART_TOKEN (a seeded guest cart,
 * see load/lighthouse/seed-cart.mjs) so cart/checkout are measured with one item.
 */
const base = (process.env.LHCI_BASE_URL ?? 'http://localhost:3200').replace(/\/+$/, '');
const pdp = process.env.LHCI_PRODUCT_SLUG ?? 'maison-lumiere-cedre-nocturne-edt';

const indexable = [
  '/',
  '/en',
  '/nuoc-hoa',
  '/en/perfumes',
  `/san-pham/${pdp}`,
  `/en/products/${pdp}`,
];
const transactional = ['/gio-hang', '/en/cart', '/thanh-toan', '/en/checkout'];

const vitals = {
  'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
  'categories:accessibility': ['error', { minScore: 0.95 }],
  'categories:best-practices': ['warn', { minScore: 0.9 }],
};

const escape = (path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (paths) => `^${escape(base)}(${paths.map(escape).join('|')})$`;

module.exports = {
  ci: {
    collect: {
      url: [...indexable, ...transactional].map((path) => `${base}${path}`),
      numberOfRuns: 3,
      settings: {
        // The CI runner's Chrome; no sandbox inside containers.
        chromeFlags: '--no-sandbox --headless=new',
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
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:seo': ['error', { minScore: 0.9 }],
          },
        },
        {
          matchingUrlPattern: exact(transactional),
          assertions: {
            ...vitals,
            'categories:performance': ['warn', { minScore: 0.9 }],
          },
        },
      ],
    },
    // Reports stay in the workflow artifacts (no public upload of shop pages).
    upload: { target: 'filesystem', outputDir: '.lighthouseci/reports' },
  },
};
