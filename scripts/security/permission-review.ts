/**
 * Generates docs/security/permission-review.md from the static scan of every Server Action,
 * Route Handler and admin page (scripts/security/permission-scan.ts).
 *
 *   pnpm security:permissions          # rewrite the document
 *   pnpm security:permissions --check  # fail when the document is out of date (CI)
 *
 * The scan supplies the facts (permission per entry point); REVIEW_NOTES below holds the
 * reviewer's notes for entry points that are public by design.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES } from '../../src/server/auth/permissions';

import { scanProject, type EntryPoint } from './permission-scan';

const ROOT = join(import.meta.dirname, '..', '..');
const OUTPUT = join(ROOT, 'docs', 'security', 'permission-review.md');

/** Reviewer notes for entry points without a staff permission (public by design). */
const REVIEW_NOTES: Record<string, string> = {
  'src/actions/account.ts':
    'Signed-in customer; every query is scoped by the session `user_id` (IDOR).',
  'src/actions/cart.ts':
    'Anonymous allowed. The cart is always the caller’s own (httpOnly cookie or session), never an id from the client.',
  'src/actions/checkout.ts#placeOrderAction':
    'Anonymous allowed. Rate-limited; prices recomputed on the server; returns a signed order-access token.',
  'src/actions/checkout.ts#quoteCheckoutAction':
    'Anonymous allowed. Read-only price quote of the caller’s own cart; no PII returned.',
  'src/actions/checkout.ts#listWardsAction': 'Public reference data (administrative units).',
  'src/actions/order-lookup.ts#lookupOrderAction':
    'Guest order lookup: order code + phone, rate-limited, generic failure (no enumeration).',
  'src/actions/returns.ts#requestReturnAction':
    'Order owner session or the order access (signed `?t=` link / lookup cookie); rate-limited per IP; unknown and foreign orders answer the same.',
  'src/actions/payment.ts#startPaymentAction':
    'Owner session or signed order token; unknown and foreign orders answer the same.',
  'src/app/api/auth/[...all]/route.ts': 'Better Auth handler (rate limits, CSRF/Origin, sessions).',
  'src/app/api/checkout/payment-status/route.ts':
    'Polled by the result page; owner session or signed order token; 404 otherwise.',
  'src/app/api/geo/wards/route.ts': 'Public reference data (administrative units).',
  'src/app/api/health/route.ts': 'Liveness probe; no data.',
  'src/app/api/internal/revalidate/route.ts':
    'Worker → web; HMAC over timestamp + body with INTERNAL_API_SECRET replaces a session.',
  'src/app/api/media/[...key]/route.ts': 'Public product/content images (uploads are images only).',
  'src/app/api/payments/simulator/vnpay/route.ts':
    'Payment simulator: 404 unless the gateway runs in simulator mode (never in production).',
  'src/app/api/search/suggestions/route.ts':
    'Public catalogue search suggestions (published data).',
  'src/app/api/webhooks/payos/route.ts':
    'Gateway webhook: signature, amount + txn_ref match and idempotency key (no session by design).',
  'src/app/api/webhooks/vnpay/route.ts':
    'Gateway IPN: signature, amount + txn_ref match and idempotency key (no session by design).',
  'src/app/api/admin/media/route.ts':
    'Any staff session at the edge; `uploadMedia` then requires `products.editContent` or `content.manage`.',
  'src/app/api/admin/audit-log/export/route.ts':
    'Cross-site requests refused (Fetch Metadata); the export itself is audited.',
  'src/app/sitemap.xml/route.ts': 'Public sitemap index (published URLs only).',
  'src/app/sitemaps/[file]/route.ts': 'Public sitemaps (published URLs only).',
  'src/app/admin/login/page.tsx': 'Sign-in page.',
  'src/app/admin/two-factor/page.tsx':
    'TOTP enrolment; requires a staff session (redirects otherwise).',
  'src/app/admin/set-password/page.tsx':
    'Invitation landing page; the single-use token is checked by Better Auth on submit.',
  'src/app/admin/(panel)/forbidden/page.tsx': 'Covered by the panel layout (any staff member).',
};

function note(entry: EntryPoint): string {
  return REVIEW_NOTES[`${entry.file}#${entry.name}`] ?? REVIEW_NOTES[entry.file] ?? '';
}

function roles(permissions: string[]): string {
  if (permissions.length === 0) return '—';
  return STAFF_ROLES.filter((role) =>
    permissions.every((p) => ROLE_PERMISSIONS[role].has(p as (typeof PERMISSIONS)[number])),
  ).join(', ');
}

const code = (values: string[]) => (values.length ? values.map((v) => `\`${v}\``).join(', ') : '—');
const cell = (text: string) => text.replace(/\|/g, '\\|');

/** `src/app/api/geo/wards/route.ts` → `/api/geo/wards`; pages likewise without groups. */
function routePath(file: string): string {
  const path = file
    .replace(/^src\/app/, '')
    .replace(/\/(route\.ts|page\.tsx)$/, '')
    .replace(/\/\([^)]+\)/g, '');
  return path || '/';
}

export function renderReview(entries: EntryPoint[]): string {
  const adminActions = entries.filter(
    (e) => e.kind === 'action' && e.file.startsWith('src/actions/admin/'),
  );
  const otherActions = entries.filter(
    (e) => e.kind === 'action' && !e.file.startsWith('src/actions/admin/'),
  );
  const routes = entries.filter((e) => e.kind === 'route');
  const pages = entries.filter((e) => e.kind === 'page');
  const missing = adminActions.filter((e) => e.permissions.length === 0);
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);

  push(
    '# Permission review — Server Actions, Route Handlers and admin pages',
    '',
    '<!-- Generated by `pnpm security:permissions` (scripts/security/permission-review.ts). Do not edit by hand. -->',
    '',
    'Pre-go-live item of ARCHITECTURE.md §12 ("review the permission check of every admin Server',
    'Action") and §15 M3 ("per-action permission review"). Every entry point below was found by a',
    'static scan of `src/` with the TypeScript compiler (real calls only, helpers and imported',
    'constants followed). Roles come from the RBAC matrix in `src/server/auth/permissions.ts`',
    '(§11.1). `src/actions/admin/permission-coverage.test.ts` fails the build when an admin Server',
    'Action or admin Route Handler has no `requirePermission` / `runAdminAction` permission, uses',
    'an unknown permission, or skips Zod validation; or when an admin page has no `requireAdminPage`.',
    '',
    'Every admin check also requires a staff session that passed TOTP within the last 8 hours',
    '(`checkAdminSession`); commands re-check the permission (`assertCan`) as defence in depth.',
    '',
    '## Summary',
    '',
    `| Entry points | Count |`,
    `| --- | --- |`,
    `| Admin Server Actions | ${adminActions.length} |`,
    `| Admin Server Actions without a permission | ${missing.length} |`,
    `| Storefront Server Actions | ${otherActions.length} |`,
    `| Route Handlers | ${routes.length} |`,
    `| Admin pages | ${pages.length} |`,
    '',
    '## Admin Server Actions',
    '',
    '| File | Action | Permission | Roles | Zod |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of adminActions) {
    push(
      `| \`${e.file.replace('src/actions/admin/', '')}\` | \`${e.name}\` | ${code(e.permissions)} | ${roles(e.permissions)} | ${e.validates ? 'yes' : '**no**'} |`,
    );
  }
  push(
    '',
    '## Route Handlers',
    '',
    '| Route | Method | Permission | Other guards | Review note |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of routes) {
    push(
      `| \`${routePath(e.file)}\` | ${e.name} | ${code([...e.permissions, ...e.conditional])} | ${cell(e.guards.join('; ') || '—')} | ${cell(note(e))} |`,
    );
  }
  push(
    '',
    '## Storefront Server Actions',
    '',
    'No staff permission by design; the guard is ownership, a signed token or a rate limit.',
    '',
    '| File | Action | Guards found | Zod | Review note |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of otherActions) {
    push(
      `| \`${e.file.replace('src/actions/', '')}\` | \`${e.name}\` | ${cell(e.guards.join('; ') || '—')} | ${e.validates ? 'yes' : '**no**'} | ${cell(note(e))} |`,
    );
  }
  push(
    '',
    '## Admin pages',
    '',
    'Pages under `(panel)` also pass the panel layout (`requireAdminPage()`, any staff member).',
    '"Shown with" lists permissions that only reveal parts of the page (`hasPermission`).',
    '',
    '| Route | Permission | Roles | Shown with | Review note |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of pages) {
    push(
      `| \`${routePath(e.file)}\` | ${code(e.permissions)} | ${roles(e.permissions)} | ${code(e.conditional)} | ${cell(note(e))} |`,
    );
  }
  push(
    '',
    '## Reviewer findings (M3)',
    '',
    '- All admin Server Actions validate with Zod and require a permission before running the',
    '  command; none relies on hidden buttons only.',
    '- The dashboard (`/admin`) is open to every staff role; its widgets are gated inside the',
    '  reporting module (`getDashboard`): money needs `dashboard.viewRevenue`, COD',
    '  `payments.reconcileCod`, refunds `payments.refund`, reviews `reviews.moderate`, privacy',
    '  requests `privacyRequests.handle`, English coverage `translations.edit`.',
    '- The audit-log CSV export needs `customers.export` (Owner) on top of `auditLog.view`, refuses',
    '  cross-site requests (Fetch Metadata) and is itself audited.',
    '- Shipping zones and rates use `settings.manage` because they change checkout prices (§11.2).',
    '- Public read endpoints (`/api/geo/wards`, `/api/search/suggestions`, `/api/media/*`) expose',
    '  published or reference data only; their abuse protection is the edge rate limit (WAF).',
    '',
  );
  return lines.join('\n');
}

const output = renderReview(scanProject(ROOT));
if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT, 'utf8');
  if (current !== output) {
    console.error(
      'docs/security/permission-review.md is out of date: run pnpm security:permissions',
    );
    process.exit(1);
  }
  console.log('permission review is up to date');
} else {
  writeFileSync(OUTPUT, output);
  console.log(`wrote ${OUTPUT}`);
}
