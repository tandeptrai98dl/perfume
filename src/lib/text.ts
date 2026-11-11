/**
 * Accent-insensitive folding for Vietnamese text: "Hồ Chí Minh" → "ho chi minh",
 * "Đà Nẵng" → "da nang". Used by client-side filtering (Combobox); the database uses
 * `immutable_unaccent` for the same purpose.
 */
export function foldVietnamese(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** True when every whitespace-separated term of `query` occurs in `value`, ignoring accents. */
export function matchesFolded(value: string, query: string): boolean {
  const haystack = foldVietnamese(value);
  return foldVietnamese(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
