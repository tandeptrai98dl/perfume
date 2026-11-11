import { describe, expect, it } from 'vitest';

import { normalizePath, planRedirect, type RedirectRow } from './redirects';
import {
  buildSnapshot,
  createRouteTableCache,
  decideRoute,
  invalidateRouteTable,
} from './route-table';

describe('normalizePath', () => {
  it.each([
    ['/tap-chi/', '/tap-chi'],
    ['/', '/'],
    ['//', null],
    ['/a//b', '/a/b'],
    ['/san-pham/n%C6%B0%E1%BB%9Bc', '/san-pham/nước'],
    ['/a?x=1', null],
    ['/a#b', null],
    ['relative', null],
    ['/a/../b', null],
    ['/a\\b', null],
    ['/a b', null],
    ['/%E0%A4%A', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

const rows = (...pairs: [string, string][]): RedirectRow[] =>
  pairs.map(([fromPath, toPath], i) => ({ id: `r${i}`, fromPath, toPath }));

const apply = (existing: RedirectRow[], fromPath: string, toPath: string) => {
  const plan = planRedirect(existing, { fromPath, toPath, statusCode: 301 });
  const kept = existing
    .filter((r) => !plan.remove.includes(r.id) && r.fromPath !== fromPath)
    .map((r) => (plan.repoint.includes(r.id) ? { ...r, toPath: plan.upsert.toPath } : r));
  return Object.fromEntries(
    [...kept, { id: 'new', ...plan.upsert }].map((r) => [r.fromPath, r.toPath]),
  );
};

describe('planRedirect', () => {
  it('adds a simple rule', () => {
    expect(apply([], '/a', '/b')).toEqual({ '/a': '/b' });
  });

  it('collapses a new rule whose target already redirects', () => {
    expect(apply(rows(['/b', '/c']), '/a', '/b')).toEqual({ '/a': '/c', '/b': '/c' });
  });

  it('re-points rules that targeted the new source', () => {
    expect(apply(rows(['/x', '/a']), '/a', '/b')).toEqual({ '/x': '/b', '/a': '/b' });
  });

  it('handles renaming a slug back (no loop)', () => {
    expect(apply(rows(['/a', '/b']), '/b', '/a')).toEqual({ '/b': '/a' });
  });

  it('breaks longer cycles and keeps every old URL pointing at the live one', () => {
    const result = apply(rows(['/a', '/b'], ['/b', '/c']), '/c', '/a');
    expect(result).toEqual({ '/b': '/a', '/c': '/a' });
  });

  it('updates an existing source instead of duplicating it', () => {
    expect(apply(rows(['/a', '/b']), '/a', '/c')).toEqual({ '/a': '/c' });
  });

  it('keeps absolute URL targets', () => {
    expect(apply([], '/old', 'https://example.com/x')).toEqual({ '/old': 'https://example.com/x' });
  });

  it('never leaves chains after a sequence of renames', () => {
    let table: RedirectRow[] = [];
    const renames: [string, string][] = [
      ['/p1', '/p2'],
      ['/p2', '/p3'],
      ['/p3', '/p4'],
      ['/p4', '/p2'],
      ['/p2', '/p5'],
    ];
    for (const [from, to] of renames) {
      const map = apply(table, from, to);
      table = Object.entries(map).map(([fromPath, toPath], i) => ({
        id: `t${i}`,
        fromPath,
        toPath,
      }));
    }
    const map = Object.fromEntries(table.map((r) => [r.fromPath, r.toPath]));
    expect(map).toEqual({ '/p1': '/p5', '/p2': '/p5', '/p3': '/p5', '/p4': '/p5' });
    for (const target of Object.values(map)) expect(map[target]).toBeUndefined();
  });
});

describe('route table', () => {
  const snapshot = buildSnapshot('v1', {
    redirects: [{ fromPath: '/tap-chi/cu', toPath: '/tap-chi/moi', statusCode: 301 }],
    contentPaths: [
      { path: '/tap-chi/moi', visibleFrom: null },
      { path: '/tap-chi/sap-ra-mat', visibleFrom: Date.parse('2030-01-01') },
    ],
    localeFallbacks: [{ path: '/en/journal/moi', toPath: '/en/journal/new' }],
  });

  it('redirects, serves, 404s and falls back between locales', () => {
    expect(decideRoute(snapshot, '/tap-chi/cu/', true)).toEqual({
      kind: 'redirect',
      location: '/tap-chi/moi',
      status: 301,
    });
    expect(decideRoute(snapshot, '/tap-chi/moi', true)).toEqual({ kind: 'next' });
    expect(decideRoute(snapshot, '/tap-chi/khong-co', true)).toEqual({ kind: 'notFound' });
    expect(decideRoute(snapshot, '/nuoc-hoa', false)).toEqual({ kind: 'next' });
    expect(decideRoute(snapshot, '/tap-chi/sap-ra-mat', true)).toEqual({ kind: 'notFound' });
    expect(decideRoute(snapshot, '/tap-chi/sap-ra-mat', true, Date.parse('2031-01-01'))).toEqual({
      kind: 'next',
    });
    expect(decideRoute(snapshot, '/en/journal/moi', true)).toEqual({
      kind: 'redirect',
      location: '/en/journal/new',
      status: 307,
    });
  });

  it('loads once, checks the version in the background and reloads on change', async () => {
    let clock = 0;
    let version = 'v1';
    let loads = 0;
    const cache = createRouteTableCache({
      now: () => clock,
      checkIntervalMs: 1000,
      loadVersion: async () => version,
      load: async () => {
        loads += 1;
        return { version, data: { redirects: [], contentPaths: [], localeFallbacks: [] } };
      },
    });
    expect((await cache.get())?.version).toBe('v1');
    await cache.get();
    expect(loads).toBe(1);

    version = 'v2';
    clock = 500;
    await cache.get();
    expect(loads).toBe(1);
    clock = 1500;
    await cache.get(); // triggers the background check
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(2);
    expect((await cache.get())?.version).toBe('v2');

    invalidateRouteTable();
    await cache.get();
    expect(loads).toBe(3);
  });

  it('fails open and backs off when loading fails', async () => {
    let clock = 0;
    let calls = 0;
    const cache = createRouteTableCache({
      now: () => clock,
      retryAfterMs: 1000,
      loadVersion: async () => 'v',
      load: async () => {
        calls += 1;
        throw new Error('db down');
      },
      onError: () => {},
    });
    expect(await cache.get()).toBeNull();
    expect(await cache.get()).toBeNull();
    expect(calls).toBe(1);
    clock = 2000;
    await cache.get();
    expect(calls).toBe(2);
  });
});
