#!/usr/bin/env node
/**
 * Prints the median Lighthouse results per URL (category scores and the §14 vitals) from the
 * `lhr-*.json` files LHCI writes to `.lighthouseci/`, as a Markdown table. Appended to the
 * GitHub job summary when GITHUB_STEP_SUMMARY is set. Informational; LHCI asserts the budgets.
 *
 * Usage: node scripts/lighthouse-summary.mjs [dir=.lighthouseci]
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.lighthouseci';
const runs = new Map();
for (const file of readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f))) {
  const lhr = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const url = new URL(lhr.requestedUrl);
  const key = `${url.pathname} (${lhr.configSettings.formFactor})`;
  runs.set(key, [...(runs.get(key) ?? []), lhr]);
}

const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};
const score = (lhrs, id) => Math.round(median(lhrs.map((l) => l.categories[id]?.score)) * 100);
const audit = (lhrs, id) => median(lhrs.map((l) => l.audits[id]?.numericValue));

const rows = [...runs.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, lhrs]) =>
    [
      `\`${key}\``,
      score(lhrs, 'performance'),
      score(lhrs, 'accessibility'),
      score(lhrs, 'best-practices'),
      score(lhrs, 'seo'),
      Math.round(audit(lhrs, 'largest-contentful-paint')),
      audit(lhrs, 'cumulative-layout-shift').toFixed(3),
      Math.round(audit(lhrs, 'total-blocking-time')),
      // Every run's LCP, to spot a bimodal page behind a median.
      lhrs
        .map((l) => Math.round(l.audits['largest-contentful-paint']?.numericValue ?? NaN))
        .join(' / '),
    ].join(' | '),
  );

const table = [
  '### Lighthouse (median of runs)',
  '',
  '| URL | Perf | A11y | BP | SEO | LCP ms | CLS | TBT ms | LCP per run |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ...rows.map((row) => `| ${row} |`),
  '',
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
