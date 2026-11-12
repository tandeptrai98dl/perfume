import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain ESM script without type declarations
import { checkBudgets, measureRoutes } from './js-budget.mjs';

/** A fake project: `.next/static/chunks/*.js` plus Next's route-bundle-stats.json. */
function fakeBuild(chunks: Record<string, string>, routes: Record<string, string[]>) {
  const root = mkdtempSync(join(tmpdir(), 'js-budget-'));
  mkdirSync(join(root, '.next/static/chunks'), { recursive: true });
  mkdirSync(join(root, '.next/diagnostics'), { recursive: true });
  for (const [name, content] of Object.entries(chunks)) {
    writeFileSync(join(root, '.next/static/chunks', name), content);
  }
  const stats = Object.entries(routes).map(([route, files]) => ({
    route,
    firstLoadUncompressedJsBytes: 0,
    firstLoadChunkPaths: files.map((file) => `.next/static/chunks/${file}`),
  }));
  writeFileSync(join(root, '.next/diagnostics/route-bundle-stats.json'), JSON.stringify(stats));
  return join(root, '.next');
}

describe('js-budget', () => {
  const shared = 'x'.repeat(5000);
  // Incompressible, so the route is well over 1 KB gzip.
  const page = randomBytes(6000).toString('base64');
  const dist = fakeBuild(
    { 'shared.js': shared, 'pdp.js': page, 'style.css': 'a{}' },
    { '/[locale]/products/[slug]': ['shared.js', 'pdp.js', 'shared.js', 'style.css'] },
  );

  it('sums the gzip size of each first-load JS chunk once', () => {
    const [pdp] = measureRoutes(dist);
    const expected =
      gzipSync(Buffer.from(shared), { level: 9 }).length +
      gzipSync(Buffer.from(page), { level: 9 }).length;
    expect(pdp).toMatchObject({
      route: '/[locale]/products/[slug]',
      gzipBytes: expected,
      chunks: 2,
    });
  });

  it('fails a route over its budget and a budgeted route that disappeared', () => {
    const routes = measureRoutes(dist);
    expect(checkBudgets(routes, { '/[locale]/products/[slug]': 100 })).toEqual([]);
    expect(checkBudgets(routes, { '/[locale]/products/[slug]': 1 })[0]).toMatch(/KB gzip > 1 KB/);
    expect(checkBudgets(routes, { '/[locale]/gone': 100 })[0]).toMatch(/not in the build output/);
  });
});
