import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  brands,
  brandTranslations,
  inventoryItems,
  locations,
  productFamilies,
  productNotes,
  products,
  productTranslations,
  productVariants,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { newId } from '@/server/lib/ids';
import {
  getProductListing,
  getSearchSuggestions,
  type ListingQueryInput,
} from '@/server/modules/catalog';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * §10.1 acceptance: filter + sort p95 < 300 ms with 3,000 SKUs (1,000 products × 3 variants,
 * 40 brands). Measures the uncached module query (the storefront adds 'use cache' on top).
 */

const PRODUCTS = 1_000;
const BRANDS = 40;

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();

  const [location] = await db.select().from(locations);
  const families = await db.query.fragranceFamilies.findMany();
  const notes = await db.query.fragranceNotes.findMany();

  const brandIds = Array.from({ length: BRANDS }, () => newId());
  await db
    .insert(brands)
    .values(brandIds.map((id, i) => ({ id, name: `Load Brand ${i}`, status: 'active' as const })));
  await db.insert(brandTranslations).values(
    brandIds.flatMap((brandId, i) =>
      (['vi', 'en'] as const).map((locale) => ({
        brandId,
        locale,
        slug: `load-brand-${i}`,
        isPublished: true,
      })),
    ),
  );

  const genders = ['male', 'female', 'unisex'] as const;
  const concentrations = ['edt', 'edp', 'parfum'] as const;
  const productRows = Array.from({ length: PRODUCTS }, (_, i) => ({
    id: newId(),
    brandId: brandIds[i % BRANDS]!,
    gender: genders[i % 3]!,
    concentration: concentrations[i % 3]!,
    status: 'active' as const,
    isFeatured: i % 17 === 0,
    publishedAt: new Date(Date.now() - i * 60_000),
  }));
  for (const rows of chunk(productRows, 500)) await db.insert(products).values(rows);
  const translations = productRows.flatMap((p, i) =>
    (['vi', 'en'] as const).map((locale) => ({
      productId: p.id,
      locale,
      name: `Load Scent ${i} ${p.concentration.toUpperCase()}`,
      slug: `load-scent-${i}`,
      isPublished: locale === 'vi' || i % 5 !== 0,
    })),
  );
  for (const rows of chunk(translations, 500)) await db.insert(productTranslations).values(rows);
  const familyLinks = productRows.flatMap((p, i) => [
    { productId: p.id, familyId: families[i % families.length]!.id, isPrimary: true },
  ]);
  for (const rows of chunk(familyLinks, 500)) await db.insert(productFamilies).values(rows);
  const noteLinks = productRows.flatMap((p, i) =>
    [0, 1, 2].map((k) => ({
      productId: p.id,
      noteId: notes[(i + k) % notes.length]!.id,
      layer: (['top', 'middle', 'base'] as const)[k]!,
    })),
  );
  for (const rows of chunk(noteLinks, 1000)) await db.insert(productNotes).values(rows);

  const variants = productRows.flatMap((p, i) =>
    [100, 50, 10].map((size, k) => ({
      id: newId(),
      productId: p.id,
      sku: `LOAD-${i}-${size}`,
      sizeMl: size,
      variantType: k === 2 ? ('travel' as const) : ('full_size' as const),
      price: 1_000_000 + ((i * 37_000 + k * 450_000) % 6_000_000),
      weightG: 300,
      isDefault: k === 0,
      position: k,
    })),
  );
  for (const rows of chunk(variants, 1000)) await db.insert(productVariants).values(rows);
  for (const rows of chunk(variants, 1000)) {
    await db
      .insert(inventoryItems)
      .values(rows.map((v, i) => ({ variantId: v.id, locationId: location!.id, onHand: i % 7 })));
  }
  await db.execute('analyze');
}, 300_000);

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

describe('listing performance at 3,000 SKUs', () => {
  it('serves filter + sort + facets with p95 < 300 ms', async () => {
    const queries: ListingQueryInput[] = [
      { locale: 'vi' },
      { locale: 'en', sort: 'newest' },
      { locale: 'vi', filters: { brands: ['load-brand-1', 'load-brand-2'] }, sort: 'price_asc' },
      {
        locale: 'vi',
        filters: { genders: ['female'], families: ['huong-go'] },
        sort: 'price_desc',
      },
      { locale: 'en', filters: { notes: ['rose'], inStock: true } },
      { locale: 'vi', filters: { types: ['travel'], minPrice: 2_000_000, maxPrice: 4_000_000 } },
      { locale: 'vi', filters: { concentrations: ['edp'] }, page: 10 },
      { locale: 'vi', q: 'load scent 12', sort: 'relevance' },
      { locale: 'en', q: 'woody' },
      { locale: 'vi', q: 'lod scnt' },
    ];
    for (const query of queries) await getProductListing(query, db); // warm up
    const samples: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      for (const query of queries) {
        const start = performance.now();
        const result = await getProductListing(query, db);
        samples.push(performance.now() - start);
        expect(result.items.length).toBeLessThanOrEqual(24);
      }
    }
    const value = p95(samples);
    console.info(`listing p95 at 3,000 SKUs: ${value.toFixed(1)} ms`);
    expect(value).toBeLessThan(300);

    const full = await getProductListing({ locale: 'vi' }, db);
    expect(full.total).toBe(PRODUCTS + 4);
  });

  it('serves suggestions quickly', async () => {
    const start = performance.now();
    const result = await getSearchSuggestions({ locale: 'vi', q: 'load' }, db);
    expect(performance.now() - start).toBeLessThan(300);
    expect(result.products).toHaveLength(6);
    expect(result.brands).toHaveLength(3);
  });
});
