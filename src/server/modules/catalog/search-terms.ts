import { foldVietnamese } from '@/lib/text';

import type { Gender } from './types';

/*
 * Search-term normalization (ARCHITECTURE.md §10.1). Runs before Postgres full-text search,
 * which uses the 'simple' configuration over immutable_unaccent(lower(...)), so terms are
 * folded the same way here: "Nước hoa gỗ" → ["go"].
 */

/** Phrases replaced before tokenizing (longest first). An empty replacement drops the phrase. */
const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['extrait de parfum', 'extrait'],
  ['eau de parfum', 'edp'],
  ['eau de toilette', 'edt'],
  ['eau de cologne', 'edc'],
  ['nuoc hoa', ''],
  ['chinh hang', ''],
  ['for men', 'men'],
  ['for women', 'women'],
];

/** Generic words that say nothing about which product is wanted. */
const STOP_WORDS = new Set([
  'perfume',
  'perfumes',
  'fragrance',
  'fragrances',
  'cologne',
  'scent',
  'scents',
  'authentic',
  'genuine',
  'original',
  'the',
  'and',
  'for',
  'with',
  'cho',
  'va',
]);

/** Gender words become a gender filter instead of a text term (genders are not indexed). */
const GENDER_WORDS: Readonly<Record<string, Gender>> = {
  nam: 'male',
  men: 'male',
  mens: 'male',
  man: 'male',
  male: 'male',
  homme: 'male',
  nu: 'female',
  women: 'female',
  womens: 'female',
  woman: 'female',
  female: 'female',
  femme: 'female',
  unisex: 'unisex',
};

const MAX_TERMS = 8;

export type NormalizedSearch = {
  /** Folded, de-duplicated text terms ([a-z0-9]+ only). */
  terms: string[];
  /** Genders implied by words such as "nam" or "women". */
  genders: Gender[];
};

export function normalizeSearchQuery(query: string): NormalizedSearch {
  let text = ` ${foldVietnamese(query)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  for (const [phrase, replacement] of PHRASES) {
    text = text.replaceAll(` ${phrase} `, ` ${replacement} `);
  }

  const terms: string[] = [];
  const genders = new Set<Gender>();
  for (const token of text.split(' ')) {
    if (!token || STOP_WORDS.has(token)) continue;
    const gender = GENDER_WORDS[token];
    if (gender) {
      genders.add(gender);
      continue;
    }
    if (!terms.includes(token)) terms.push(token);
  }
  return { terms: terms.slice(0, MAX_TERMS), genders: [...genders].sort() };
}

/**
 * `to_tsquery('simple', …)` input: every term must match; the last one also matches as a
 * prefix (as-you-type) when it has at least 3 characters. Terms are [a-z0-9]+ so no tsquery
 * syntax can be injected.
 */
export function toPrefixTsQuery(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms
    .map((term, index) => (index === terms.length - 1 && term.length >= 3 ? `${term}:*` : term))
    .join(' & ');
}
