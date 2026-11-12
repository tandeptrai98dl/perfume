import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanProject, scanSource } from '../../../scripts/security/permission-scan';
import { PERMISSIONS } from '../../server/auth/permissions';

/*
 * Per-action permission review (ARCHITECTURE.md §12, M3): every admin Server Action and admin
 * Route Handler must validate its input and require a known permission. Static scan of the
 * real source (scripts/security/permission-scan.ts); docs/security/permission-review.md is
 * generated from the same scan (`pnpm security:permissions`).
 */

const ROOT = resolve(__dirname, '../../..');
const entries = scanProject(ROOT);
const KNOWN = new Set<string>(PERMISSIONS);

describe('admin entry points require a permission', () => {
  const adminActions = entries.filter(
    (entry) => entry.kind === 'action' && entry.file.startsWith('src/actions/admin/'),
  );
  const adminRoutes = entries.filter(
    (entry) => entry.kind === 'route' && entry.file.startsWith('src/app/api/admin/'),
  );

  it('finds the admin actions and routes', () => {
    expect(adminActions.length).toBeGreaterThan(40);
    expect(adminRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(adminActions.map((entry) => [`${entry.file}#${entry.name}`, entry] as const))(
    '%s calls requirePermission with a known permission',
    (_, entry) => {
      expect(entry.permissions, 'no requirePermission / runAdminAction found').not.toEqual([]);
      for (const permission of entry.permissions) expect(KNOWN).toContain(permission);
      expect(entry.validates, 'no Zod validation found').toBe(true);
    },
  );

  it.each(adminRoutes.map((entry) => [`${entry.file}#${entry.name}`, entry] as const))(
    '%s calls requirePermission with a known permission',
    (_, entry) => {
      expect(entry.permissions).not.toEqual([]);
      for (const permission of entry.permissions) expect(KNOWN).toContain(permission);
    },
  );

  it('every admin page (panel and print) calls requireAdminPage itself', () => {
    // The (panel) layout already requires a 2FA-verified staff session; pages still check
    // their own permission. Only the "forbidden" landing page relies on the layout alone.
    const LAYOUT_ONLY = new Set(['src/app/admin/(panel)/forbidden/page.tsx']);
    const pages = entries.filter(
      (entry) =>
        entry.kind === 'page' &&
        /^src\/app\/admin\/\((panel|print)\)\//.test(entry.file) &&
        !LAYOUT_ONLY.has(entry.file),
    );
    expect(pages.length).toBeGreaterThan(20);
    const unguarded = pages.filter((page) => page.permissions.length === 0).map((p) => p.file);
    expect(unguarded).toEqual([]);
    for (const page of pages) {
      for (const permission of page.permissions) expect(KNOWN).toContain(permission);
    }
  });
});

describe('scanner', () => {
  it('flags an action without a permission check', () => {
    const [entry] = scanSource(
      'src/actions/admin/fake.ts',
      `'use server';
       // requirePermission('orders.view') in a comment does not count
       export async function leakyAction(raw: unknown) {
         const input = schema.safeParse(raw);
         return doIt(input);
       }`,
      null,
    );
    expect(entry).toMatchObject({ name: 'leakyAction', permissions: [], validates: true });
  });

  it('follows local helpers, constants and JSX components', () => {
    const [action] = scanSource(
      'src/actions/admin/fake.ts',
      `'use server';
       const PERMISSION = 'staff.manage' as const;
       async function authorized() { await requirePermission(PERMISSION); }
       export async function a(raw: unknown) { schema.parse(raw); await authorized(); }`,
      null,
    );
    expect(action!.permissions).toEqual(['staff.manage']);

    const [page] = scanSource(
      'src/app/admin/(panel)/x/page.tsx',
      `export default function Page() { return <Content />; }
       async function Content() { await requireAdminPage('auditLog.view'); return null; }`,
      'page',
    );
    expect(page!.permissions).toEqual(['auditLog.view']);
  });

  it('reports unresolvable permissions as dynamic', () => {
    const [entry] = scanSource(
      'src/actions/admin/fake.ts',
      `'use server';
       export async function a(raw: unknown, p: string) { await requirePermission(p); }`,
      null,
    );
    expect(entry!.permissions).toEqual(['<dynamic>']);
  });
});
