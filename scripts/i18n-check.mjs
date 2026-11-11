#!/usr/bin/env node
/**
 * Fails when messages/vi.json and messages/en.json do not have the same keys.
 * The "admin" namespace is Vietnamese-only in MVP (ADR-0002) and is excluded.
 * Also fails on empty strings so untranslated placeholders do not ship.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXCLUDED_NAMESPACES = new Set(['admin']);
const locales = ['vi', 'en'];

function flatten(obj, prefix = '') {
  const out = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!prefix && EXCLUDED_NAMESPACES.has(key)) continue;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const maps = Object.fromEntries(
  locales.map((locale) => {
    const file = resolve(process.cwd(), 'messages', `${locale}.json`);
    return [locale, flatten(JSON.parse(readFileSync(file, 'utf8')))];
  }),
);

const problems = [];
for (const a of locales) {
  for (const b of locales) {
    if (a === b) continue;
    for (const key of maps[a].keys()) {
      if (!maps[b].has(key)) problems.push(`missing in ${b}.json: ${key}`);
    }
  }
  for (const [key, value] of maps[a]) {
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`empty or non-string value in ${a}.json: ${key}`);
    }
  }
}

const unique = [...new Set(problems)];
if (unique.length > 0) {
  console.error(`i18n:check failed (${unique.length} problem(s)):`);
  for (const p of unique) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`i18n:check passed: ${maps.vi.size} keys in each locale (excluding admin).`);
