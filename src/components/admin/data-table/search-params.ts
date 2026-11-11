import { createLoader, parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';

/**
 * URL state of admin lists (`?q=&page=&pageSize=&sort=&dir=`), shared by server pages
 * (loader) and the client DataTable (useQueryStates). Server pages re-validate with the
 * module's Zod list schema before querying.
 */
export const PAGE_SIZES = [20, 50, 100] as const;

export const tableParams = {
  q: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(20),
  sort: parseAsString.withDefault(''),
  dir: parseAsStringLiteral(['asc', 'desc'] as const).withDefault('desc'),
};

export const loadTableParams = createLoader(tableParams);

/** Normalises loader output into a safe list query (unknown page sizes fall back to 20). */
export function toListQuery(params: Awaited<ReturnType<typeof loadTableParams>>) {
  return {
    q: params.q.trim().slice(0, 100),
    page: Math.max(1, Math.min(params.page, 10_000)),
    pageSize: (PAGE_SIZES as readonly number[]).includes(params.pageSize) ? params.pageSize : 20,
    sort: params.sort.slice(0, 40),
    dir: params.dir,
  };
}
