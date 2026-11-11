import type { RedirectStatusCode } from './types';

/**
 * Pure redirect rules (no I/O) shared by the content commands, the proxy route table and
 * unit tests. Invariant kept by `planRedirect`: the table never contains chains or loops, so
 * the proxy resolves any path with a single lookup.
 */

const MAX_PATH_LENGTH = 2048;

/**
 * Canonical form of a public pathname: leading slash, no query/fragment, percent-decoded,
 * NFC-normalized, no trailing slash (except "/"), no "." or ".." segments. Returns null when
 * the value is not a usable path.
 */
export function normalizePath(raw: string): string | null {
  let value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/[?#]/.test(value)) return null;
  try {
    value = decodeURI(value);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  value = value.normalize('NFC').replace(/\/{2,}/g, '/');
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  if (value.length > 1) value = value.replace(/\/+$/, '');
  if (value.length > MAX_PATH_LENGTH) return null;
  return value;
}

export type RedirectRow = { id: string; fromPath: string; toPath: string };

export type RedirectPlan = {
  /** Final rule to insert or update (target already collapsed). */
  upsert: { fromPath: string; toPath: string; statusCode: RedirectStatusCode };
  /** Existing rules whose target must move to `upsert.toPath` (collapse incoming chains). */
  repoint: string[];
  /** Existing rules to delete (their source is now a live URL, or they became self-loops). */
  remove: string[];
};

const MAX_CHAIN = 20;

/**
 * Plans `fromPath → toPath` against the existing rules:
 * - the target is followed through existing rules, so `A→B` + new `X→A` stores `X→B`;
 * - rules pointing at `fromPath` are re-pointed to the final target (`Y→X` becomes `Y→B`);
 * - the final target is a live URL, so a rule starting there is removed; this also resolves
 *   loops such as renaming a slug back (`A→B` exists, new `B→A` ⇒ remove `A→B`, add `B→A`);
 * - re-pointing never creates self-redirects (those rules are removed instead).
 *
 * `existing` only needs the rules reachable from `toPath` and the rules targeting `fromPath`.
 */
export function planRedirect(
  existing: RedirectRow[],
  input: { fromPath: string; toPath: string; statusCode: RedirectStatusCode },
): RedirectPlan {
  const byFrom = new Map(existing.map((row) => [row.fromPath, row]));
  const visited = new Set([input.fromPath]);
  let target = input.toPath;
  for (let i = 0; i < MAX_CHAIN; i += 1) {
    const next = byFrom.get(target);
    if (!next || visited.has(target)) break;
    visited.add(target);
    target = next.toPath;
  }
  // The chain led back to the source: the requested target becomes the live URL.
  if (target === input.fromPath || visited.has(target)) target = input.toPath;

  const remove = new Set<string>();
  const repoint: string[] = [];
  const liveRule = byFrom.get(target);
  if (liveRule) remove.add(liveRule.id);

  for (const row of existing) {
    if (row.toPath !== input.fromPath || row.fromPath === input.fromPath) continue;
    if (row.fromPath === target) remove.add(row.id);
    else repoint.push(row.id);
  }
  const existingSource = byFrom.get(input.fromPath);
  if (existingSource) remove.delete(existingSource.id);

  return {
    upsert: { fromPath: input.fromPath, toPath: target, statusCode: input.statusCode },
    repoint: repoint.filter((id) => !remove.has(id)),
    remove: [...remove],
  };
}

/** Looks a path up in a collapsed table (single hop; chains cannot exist). */
export function resolveFromTable<T extends { toPath: string }>(
  table: ReadonlyMap<string, T>,
  rawPath: string,
): T | null {
  const path = normalizePath(rawPath);
  if (!path) return null;
  return table.get(path) ?? null;
}
