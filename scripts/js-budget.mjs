#!/usr/bin/env node
/**
 * First-load JavaScript budget (ARCHITECTURE.md §14.1, PDP JS budget). Run after `pnpm build`:
 * reads the per-route first-load chunk list that Next.js writes to
 * `.next/diagnostics/route-bundle-stats.json`, gzips each chunk (level 9, the convention of
 * the "First Load JS" column older Next.js versions printed) and fails when a budgeted route
 * is over its limit. Every storefront route is listed for information, split into the shared
 * framework runtime (Next.js + React, `rootMainFiles`, loaded by every route) and the app's
 * own code; the table also goes to the GitHub job summary when GITHUB_STEP_SUMMARY is set.
 *
 * §14.1 targets 150 KB gzip for the PDP. Next.js 16 + React 19's runtime alone is ~136 KB
 * gzip, so that total is out of reach without leaving the stack; the enforced limit is a
 * regression ceiling just above the measured size (224 KB after the M3 performance pass)
 * per docs/adr/0026-first-load-js-budget.md (Accepted). The 150 KB target is still
 * reported.
 *
 * Usage: node scripts/js-budget.mjs [--dist .next]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;

/** Route (as Next.js names it) → enforced max first-load JS in KB gzip. */
export const BUDGETS = {
  '/[locale]/products/[slug]': 240,
};

/** §14.1 long-term targets, reported as warnings (not enforced; ADR-0026). */
export const TARGETS = {
  '/[locale]/products/[slug]': 150,
};

/** Admin, API and dev-only routes are not part of the storefront report. */
const isStorefront = (route) =>
  !/^\/(admin|api|_global-error)(\/|$)/.test(route) && !route.includes('/dev/');

/**
 * @param {string} distDir the Next.js build directory (`.next`)
 * @returns {{ route: string, gzipBytes: number, rawBytes: number, chunks: number }[]}
 */
export function measureRoutes(distDir) {
  const statsFile = join(distDir, 'diagnostics', 'route-bundle-stats.json');
  if (!existsSync(statsFile)) {
    throw new Error(`${statsFile} not found: run \`pnpm build\` first (Next.js 16+).`);
  }
  const manifestFile = join(distDir, 'build-manifest.json');
  /** Framework runtime chunks every route loads (project-relative, like the stats paths). */
  const framework = new Set(
    existsSync(manifestFile)
      ? JSON.parse(readFileSync(manifestFile, 'utf8')).rootMainFiles.map((file) =>
          join(relative(resolve(distDir, '..'), distDir), file),
        )
      : [],
  );
  /** @type {{ route: string, firstLoadChunkPaths: string[] }[]} */
  const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
  // Chunk paths are relative to the project root (".next/static/chunks/…").
  const root = resolve(distDir, '..');
  const sizes = new Map();
  const sizeOf = (chunk) => {
    if (!sizes.has(chunk)) {
      const bytes = readFileSync(resolve(root, chunk));
      sizes.set(chunk, { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
    }
    return sizes.get(chunk);
  };
  return stats.map(({ route, firstLoadChunkPaths }) => {
    const unique = [...new Set(firstLoadChunkPaths.filter((chunk) => chunk.endsWith('.js')))];
    const total = unique.reduce(
      (sum, chunk) => {
        const size = sizeOf(chunk);
        const isFramework = framework.has(join(chunk));
        return {
          raw: sum.raw + size.raw,
          gzip: sum.gzip + size.gzip,
          frameworkGzip: sum.frameworkGzip + (isFramework ? size.gzip : 0),
        };
      },
      { raw: 0, gzip: 0, frameworkGzip: 0 },
    );
    return {
      route,
      gzipBytes: total.gzip,
      rawBytes: total.raw,
      frameworkGzipBytes: total.frameworkGzip,
      chunks: unique.length,
    };
  });
}

/**
 * @param {ReturnType<typeof measureRoutes>} routes
 * @param {Record<string, number>} budgets
 */
export function checkBudgets(routes, budgets = BUDGETS) {
  const failures = [];
  for (const [route, limitKb] of Object.entries(budgets)) {
    const measured = routes.find((r) => r.route === route);
    if (!measured) failures.push(`${route}: not in the build output (route renamed?)`);
    else if (measured.gzipBytes > limitKb * KB) {
      failures.push(`${route}: ${(measured.gzipBytes / KB).toFixed(1)} KB gzip > ${limitKb} KB`);
    }
  }
  return failures;
}

const kb = (bytes) => (bytes / KB).toFixed(1);

function report(routes, budgets, targets) {
  const rows = routes
    .filter((r) => isStorefront(r.route) || r.route in budgets)
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .map((r) => {
      const limit = budgets[r.route];
      const target = targets[r.route];
      const status = limit === undefined ? '' : r.gzipBytes > limit * KB ? 'OVER' : 'ok';
      return [
        `\`${r.route}\``,
        kb(r.gzipBytes),
        kb(r.frameworkGzipBytes),
        kb(r.gzipBytes - r.frameworkGzipBytes),
        (r.rawBytes / KB).toFixed(0),
        limit ?? '',
        target ?? '',
        status,
      ].join(' | ');
    });
  return [
    '### First-load JavaScript (storefront, KB gzip)',
    '',
    '| Route | Total | Framework | App | Raw KB | Limit | §14.1 target | |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const distIndex = process.argv.indexOf('--dist');
  const distDir = resolve(distIndex > 0 ? process.argv[distIndex + 1] : '.next');
  const routes = measureRoutes(distDir);
  const table = report(routes, BUDGETS, TARGETS);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  const failures = checkBudgets(routes, BUDGETS);
  if (failures.length > 0) {
    console.error(`JS budget exceeded (ARCHITECTURE.md §14.1):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  for (const [route, target] of Object.entries(TARGETS)) {
    const measured = routes.find((r) => r.route === route);
    if (measured && measured.gzipBytes > target * KB) {
      // GitHub annotation (warning), not a failure: see ADR-0026.
      console.log(
        `::warning title=JS budget target::${route} ${kb(measured.gzipBytes)} KB gzip > §14.1 target ${target} KB (limit ${BUDGETS[route]} KB, ADR-0026)`,
      );
    }
  }
  console.log('JS budgets OK.');
}
