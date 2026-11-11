import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  brands,
  brandTranslations,
  collectionProducts,
  collections,
  collectionTranslations,
  inventoryItems,
  locations,
  products,
  productTranslations,
  productVariants,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { newId } from '@/server/lib/ids';
import {
  getBrandBySlug,
  getBrandList,
  getCollectionBySlug,
  getFamilyBySlug,
  getFeaturedProducts,
  getProductDetail,
  getProductListing,
  getRelatedProducts,
  getSearchSuggestions,
  getVariantOffers,
  type ListingQueryInput,
} from '@/server/modules/catalog';
import { getVariantAvailability } from '@/server/modules/inventory';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

const SLUG = {
  edt: 'maison-lumiere-cedre-nocturne-edt',
  edp: 'maison-lumiere-cedre-nocturne-edp',
  hoaDem: 'atelier-suong-hoa-dem-edp',
  soleil: 'ambre-studio-soleil-ambre-parfum',
};

async function productId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productTranslations.productId })
    .from(productTranslations)
    .where(and(eq(productTranslations.locale, 'vi'), eq(productTranslations.slug, slug)));
  return row!.id;
}

async function names(input: ListingQueryInput): Promise<string[]> {
  const result = await getProductListing(input, db);
  return result.items.map((item) => item.name);
}

let defaultLocationId: string;
let collectionId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();

  const [location] = await db.select().from(locations).where(eq(locations.isDefault, true));
  defaultLocationId = location!.id;
  const edtId = await productId(SLUG.edt);
  const soleilId = await productId(SLUG.soleil);
  const edpId = await productId(SLUG.edp);

  // A decant (cheapest, in stock) must never be exposed (ADR-0015).
  const decantId = newId();
  await db.insert(productVariants).values({
    id: decantId,
    productId: edtId,
    sku: 'TEST-DECANT-5',
    sizeMl: 5,
    variantType: 'decant',
    price: 150_000,
    weightG: 20,
    position: 9,
  });
  await db
    .insert(inventoryItems)
    .values({ variantId: decantId, locationId: defaultLocationId, onHand: 50 });

  // A tester that is out of stock.
  const testerId = newId();
  await db.insert(productVariants).values({
    id: testerId,
    productId: soleilId,
    sku: 'TEST-SOLEIL-TESTER',
    sizeMl: 50,
    variantType: 'tester',
    price: 4_200_000,
    weightG: 300,
    position: 5,
  });
  await db
    .insert(inventoryItems)
    .values({ variantId: testerId, locationId: defaultLocationId, onHand: 0 });

  // Cèdre Nocturne EDP: 5 on hand, 5 reserved → nothing available.
  const [edpVariant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, edpId));
  await db
    .update(inventoryItems)
    .set({ reserved: 5 })
    .where(eq(inventoryItems.variantId, edpVariant!.id));

  // A draft product and a product of an archived brand: both hidden.
  const [maison] = await db.select().from(brands).where(eq(brands.name, 'Maison Lumière'));
  const draftId = newId();
  await db.insert(products).values({
    id: draftId,
    brandId: maison!.id,
    gender: 'male',
    concentration: 'edc',
    status: 'draft',
  });
  await db.insert(productTranslations).values([
    {
      productId: draftId,
      locale: 'vi',
      name: 'Cèdre Brouillon EDC',
      slug: 'draft-edc',
      isPublished: true,
    },
    {
      productId: draftId,
      locale: 'en',
      name: 'Cèdre Brouillon EDC',
      slug: 'draft-edc',
      isPublished: true,
    },
  ]);
  await db
    .insert(productVariants)
    .values({ productId: draftId, sku: 'TEST-DRAFT', sizeMl: 100, price: 1_000_000, weightG: 400 });

  const archivedBrandId = newId();
  await db
    .insert(brands)
    .values({ id: archivedBrandId, name: 'Maison Archivée', status: 'archived' });
  await db.insert(brandTranslations).values([
    { brandId: archivedBrandId, locale: 'vi', slug: 'maison-archivee', isPublished: true },
    { brandId: archivedBrandId, locale: 'en', slug: 'maison-archivee', isPublished: true },
  ]);
  const orphanId = newId();
  await db.insert(products).values({
    id: orphanId,
    brandId: archivedBrandId,
    gender: 'unisex',
    concentration: 'edp',
    status: 'active',
  });
  await db.insert(productTranslations).values({
    productId: orphanId,
    locale: 'vi',
    name: 'Archivée EDP',
    slug: 'archivee-edp',
    isPublished: true,
  });
  await db.insert(productVariants).values({
    productId: orphanId,
    sku: 'TEST-ARCHIVED',
    sizeMl: 50,
    price: 900_000,
    weightG: 300,
  });

  // Manual collection: Soleil first, then Hoa Đêm (vi + en translations).
  collectionId = newId();
  await db.insert(collections).values({ id: collectionId, kind: 'manual' });
  await db.insert(collectionTranslations).values([
    {
      collectionId,
      locale: 'vi',
      name: 'Quà tặng mùa đông',
      slug: 'qua-tang-mua-dong',
      isPublished: true,
    },
    { collectionId, locale: 'en', name: 'Winter gifts', slug: 'winter-gifts', isPublished: true },
  ]);
  await db.insert(collectionProducts).values([
    { collectionId, productId: soleilId, position: 0 },
    { collectionId, productId: await productId(SLUG.hoaDem), position: 1 },
  ]);
  const inactiveId = newId();
  await db.insert(collections).values({ id: inactiveId, kind: 'manual', isActive: false });
  await db
    .insert(collectionTranslations)
    .values({ collectionId: inactiveId, locale: 'vi', name: 'Cũ', slug: 'cu', isPublished: true });
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('visibility', () => {
  it('lists only active products of active brands in Vietnamese', async () => {
    expect((await names({ locale: 'vi' })).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
      'Hoa Đêm EDP',
      'Soleil Ambré PARFUM',
    ]);
  });

  it('hides products without a published English translation under en (ADR-0021)', async () => {
    const en = await names({ locale: 'en' });
    expect(en).toHaveLength(3);
    expect(en).not.toContain('Hoa Đêm EDP');
    expect(await getProductDetail({ locale: 'en', slug: SLUG.hoaDem }, db)).toBeNull();
    expect(await names({ locale: 'en', q: 'hoa dem' })).toEqual([]);
    const suggestions = await getSearchSuggestions({ locale: 'en', q: 'hoa' }, db);
    expect(suggestions.products.map((p) => p.name)).not.toContain('Hoa Đêm EDP');
  });

  it('does not return draft products or archived brands', async () => {
    expect(await getProductDetail({ locale: 'vi', slug: 'draft-edc' }, db)).toBeNull();
    expect(await getProductDetail({ locale: 'vi', slug: 'archivee-edp' }, db)).toBeNull();
    expect(await getBrandBySlug({ locale: 'vi', slug: 'maison-archivee' }, db)).toBeNull();
    expect((await getBrandList('vi', db)).map((b) => b.name)).not.toContain('Maison Archivée');
  });

  it('counts only visible products per brand and locale', async () => {
    const en = await getBrandList('en', db);
    expect(en.find((b) => b.name === 'Atelier Sương')?.productCount).toBe(0);
    expect(en.find((b) => b.name === 'Maison Lumière')?.productCount).toBe(2);
  });
});

describe('decants (ADR-0015)', () => {
  it('never expose decant variants in listings, detail, offers or facets', async () => {
    const listing = await getProductListing({ locale: 'vi' }, db);
    const edt = listing.items.find((item) => item.slug === SLUG.edt)!;
    expect(edt.fromPrice).toBe(2_300_000);
    expect(edt.variantCount).toBe(2);
    expect(listing.facets.types.map((t) => t.value)).not.toContain('decant');

    const detail = await getProductDetail({ locale: 'vi', slug: SLUG.edt }, db);
    expect(detail!.variants.map((v) => v.variantType)).not.toContain('decant');
    const offers = await getVariantOffers(detail!.id, db);
    expect(offers.map((o) => o.sku)).not.toContain('TEST-DECANT-5');

    // A "decant" type filter is dropped by the schema, not applied.
    expect(await names({ locale: 'vi', filters: { types: ['decant' as never] } })).toHaveLength(4);
  });
});

describe('filters, facets, sorting, pagination', () => {
  it('filters by brand and keeps disjunctive brand counts', async () => {
    const result = await getProductListing(
      { locale: 'vi', filters: { brands: ['maison-lumiere'] } },
      db,
    );
    expect(result.items.map((i) => i.name).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
    // Brand facet ignores the brand filter itself…
    expect(result.facets.brands.map((b) => [b.value, b.count])).toEqual([
      ['ambre-studio', 1],
      ['atelier-suong', 1],
      ['maison-lumiere', 2],
    ]);
    // …while other facets apply it.
    expect(result.facets.genders).toEqual([{ value: 'male', label: 'male', count: 2 }]);
  });

  it('filters by gender, family (localized slug), note and concentration', async () => {
    expect(await names({ locale: 'vi', filters: { genders: ['female'] } })).toEqual([
      'Hoa Đêm EDP',
    ]);
    expect((await names({ locale: 'vi', filters: { families: ['huong-go'] } })).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
      'Soleil Ambré PARFUM',
    ]);
    expect(
      await names({ locale: 'en', filters: { families: ['woody'], concentrations: ['edp'] } }),
    ).toEqual(['Cèdre Nocturne EDP']);
    expect(await names({ locale: 'en', filters: { notes: ['jasmine'] } })).toEqual([]);
    expect(await names({ locale: 'vi', filters: { notes: ['hoa-nhai'] } })).toEqual([
      'Hoa Đêm EDP',
    ]);
  });

  it('filters by variant type and shows the matching price', async () => {
    const travel = await getProductListing({ locale: 'vi', filters: { types: ['travel'] } }, db);
    expect(travel.items.map((i) => [i.name, i.fromPrice])).toEqual([['Hoa Đêm EDP', 650_000]]);
    const testers = await getProductListing({ locale: 'vi', filters: { types: ['tester'] } }, db);
    expect(testers.items.map((i) => [i.name, i.fromPrice])).toEqual([
      ['Soleil Ambré PARFUM', 4_200_000],
    ]);
  });

  it('filters by price range on variant prices', async () => {
    const result = await getProductListing(
      { locale: 'vi', filters: { minPrice: 3_000_000, maxPrice: 4_000_000 }, sort: 'price_asc' },
      db,
    );
    expect(result.items.map((i) => [i.name, i.fromPrice])).toEqual([
      ['Cèdre Nocturne EDT', 3_200_000],
      ['Cèdre Nocturne EDP', 3_900_000],
    ]);
  });

  it('filters by availability (on hand minus reserved)', async () => {
    const result = await getProductListing({ locale: 'vi', filters: { inStock: true } }, db);
    expect(result.items.map((i) => i.name)).not.toContain('Cèdre Nocturne EDP');
    expect(result.total).toBe(3);
    // Soleil's tester is out of stock, so its in-stock price is the full size.
    expect(result.items.find((i) => i.slug === SLUG.soleil)?.fromPrice).toBe(5_400_000);
    const all = await getProductListing({ locale: 'vi' }, db);
    expect(all.facets.inStock).toBe(3);
  });

  it('sorts by price both ways', async () => {
    expect(await names({ locale: 'vi', sort: 'price_asc' })).toEqual([
      'Hoa Đêm EDP',
      'Cèdre Nocturne EDT',
      'Cèdre Nocturne EDP',
      'Soleil Ambré PARFUM',
    ]);
    expect((await names({ locale: 'vi', sort: 'price_desc' }))[0]).toBe('Soleil Ambré PARFUM');
  });

  it('paginates with a total count', async () => {
    const page2 = await getProductListing(
      { locale: 'vi', pageSize: 3, page: 2, sort: 'price_asc' },
      db,
    );
    expect(page2.total).toBe(4);
    expect(page2.totalPages).toBe(2);
    expect(page2.items.map((i) => i.name)).toEqual(['Soleil Ambré PARFUM']);
    const beyond = await getProductListing({ locale: 'vi', pageSize: 3, page: 5 }, db);
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(4);
  });

  it('scopes listings to a brand, family and collection (collection order kept)', async () => {
    const [maison] = await db.select().from(brands).where(eq(brands.name, 'Maison Lumière'));
    expect(await names({ locale: 'vi', scope: { kind: 'brand', id: maison!.id } })).toHaveLength(2);
    const family = await getFamilyBySlug({ locale: 'en', slug: 'floral' }, db);
    expect(family?.localeSlugs).toEqual({ vi: 'huong-hoa', en: 'floral' });
    expect(await names({ locale: 'vi', scope: { kind: 'family', id: family!.id } })).toEqual([
      'Hoa Đêm EDP',
    ]);
    expect(await names({ locale: 'vi', scope: { kind: 'collection', id: collectionId } })).toEqual([
      'Soleil Ambré PARFUM',
      'Hoa Đêm EDP',
    ]);
    expect(await names({ locale: 'en', scope: { kind: 'collection', id: collectionId } })).toEqual([
      'Soleil Ambré PARFUM',
    ]);
    expect(await getCollectionBySlug({ locale: 'vi', slug: 'cu' }, db)).toBeNull();
    expect(
      (await getCollectionBySlug({ locale: 'en', slug: 'winter-gifts' }, db))?.localeSlugs,
    ).toEqual({
      vi: 'qua-tang-mua-dong',
      en: 'winter-gifts',
    });
  });
});

describe('search (§10.1)', () => {
  it('finds woody products for "nước hoa gỗ" and "nuoc hoa go"', async () => {
    const expected = ['Cèdre Nocturne EDP', 'Cèdre Nocturne EDT', 'Soleil Ambré PARFUM'];
    expect((await names({ locale: 'vi', q: 'nước hoa gỗ' })).sort()).toEqual(expected);
    expect((await names({ locale: 'vi', q: 'nuoc hoa go' })).sort()).toEqual(expected);
  });

  it('finds woody products for "woody perfume" on en only', async () => {
    expect(await names({ locale: 'en', q: 'woody perfume' })).toHaveLength(3);
    expect(await names({ locale: 'vi', q: 'woody perfume' })).toEqual([]);
  });

  it('matches brand + product name like "dior sauvage"', async () => {
    expect((await names({ locale: 'vi', q: 'lumière cèdre' })).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
    expect(await names({ locale: 'vi', q: 'lumiere nocturne edt' })).toEqual([
      'Cèdre Nocturne EDT',
    ]);
    // Every term must match: another brand's name narrows to nothing, not to "any".
    const mixed = await getProductListing({ locale: 'vi', q: 'ambre nocturne' }, db);
    expect(mixed.fuzzy).toBe(true);
  });

  it('tolerates a one-character typo with trigram fallback', async () => {
    const result = await getProductListing({ locale: 'vi', q: 'nocturme', sort: 'relevance' }, db);
    expect(result.fuzzy).toBe(true);
    expect(result.items.map((i) => i.name).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
    expect((await names({ locale: 'vi', q: 'lumeire' })).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
  });

  it('applies gender words as a filter', async () => {
    expect((await names({ locale: 'vi', q: 'nước hoa nam' })).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
  });

  it('suggests up to 6 products and 3 brands with prefix matching', async () => {
    const result = await getSearchSuggestions({ locale: 'vi', q: 'lumi' }, db);
    expect(result.products.map((p) => p.name).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
    expect(result.brands.map((b) => b.name)).toEqual(['Maison Lumière']);
    const generic = await getSearchSuggestions({ locale: 'vi', q: 'nước hoa' }, db);
    expect(generic).toEqual({ products: [], brands: [] });
  });
});

describe('product detail', () => {
  it('returns variants, notes by layer, families, siblings and locale slugs', async () => {
    const detail = await getProductDetail({ locale: 'en', slug: SLUG.edt }, db);
    expect(detail).not.toBeNull();
    expect(detail!.variants.map((v) => [v.sku, v.price, v.isDefault])).toEqual([
      ['MAIS-CEDR-EDT-100', 3_200_000, true],
      ['MAIS-CEDR-EDT-50', 2_300_000, false],
    ]);
    expect(detail!.notes.top.map((n) => n.name)).toEqual(['Bergamot', 'Grapefruit']);
    expect(detail!.notes.base.map((n) => n.name)).toEqual(['Sandalwood']);
    expect(detail!.families.map((f) => [f.name, f.isPrimary])).toEqual([
      ['Woody', true],
      ['Citrus', false],
    ]);
    expect(detail!.siblings.map((s) => [s.concentration, s.isCurrent])).toEqual([
      ['edt', true],
      ['edp', false],
    ]);
    expect(detail!.localeSlugs).toEqual({ vi: SLUG.edt, en: SLUG.edt });
    expect(detail!.brand.slug).toBe('maison-lumiere');
    expect(detail!.categories.map((c) => c.name)).toEqual(["Men's fragrances"]);
  });

  it('omits the English slug when the translation is unpublished', async () => {
    const detail = await getProductDetail({ locale: 'vi', slug: SLUG.hoaDem }, db);
    expect(detail!.localeSlugs).toEqual({ vi: SLUG.hoaDem });
    // A line with a single product: the switcher hides itself.
    expect(detail!.siblings.map((s) => s.isCurrent)).toEqual([true]);
  });

  it('reports live stock states', async () => {
    const soleil = await getProductDetail({ locale: 'vi', slug: SLUG.soleil }, db);
    const offers = await getVariantOffers(soleil!.id, db);
    expect(offers.map((o) => [o.sku, o.available, o.stockState])).toEqual([
      ['AMBR-SOLE-PARFUM-50', 4, 'in_stock'],
      ['TEST-SOLEIL-TESTER', 0, 'out_of_stock'],
    ]);
    const edp = await getProductDetail({ locale: 'vi', slug: SLUG.edp }, db);
    expect((await getVariantOffers(edp!.id, db))[0]?.stockState).toBe('out_of_stock');

    const hoa = await getProductDetail({ locale: 'vi', slug: SLUG.hoaDem }, db);
    const [full] = hoa!.variants;
    await db
      .update(inventoryItems)
      .set({ onHand: 2 })
      .where(eq(inventoryItems.variantId, full!.id));
    expect((await getVariantAvailability([full!.id, newId()], db)).get(full!.id)?.stockState).toBe(
      'low_stock',
    );
    const missing = await getVariantAvailability([newId()], db);
    expect([...missing.values()][0]?.stockState).toBe('out_of_stock');
  });

  it('suggests related products from the same family, excluding the product line', async () => {
    const edt = await getProductDetail({ locale: 'en', slug: SLUG.edt }, db);
    const related = await getRelatedProducts('en', edt!.id, 4, db);
    expect(related.map((p) => p.name)).toEqual(['Soleil Ambré PARFUM']);
  });

  it('lists featured products for the home page', async () => {
    expect(await getFeaturedProducts('en', 8, db)).toHaveLength(3);
  });
});

describe('performance', () => {
  it('keeps a filtered listing with facets fast', async () => {
    await getProductListing({ locale: 'vi' }, db);
    const start = performance.now();
    for (let i = 0; i < 10; i += 1) {
      await getProductListing(
        { locale: 'vi', filters: { families: ['huong-go'], inStock: true }, sort: 'price_asc' },
        db,
      );
    }
    expect((performance.now() - start) / 10).toBeLessThan(100);
  });
});
