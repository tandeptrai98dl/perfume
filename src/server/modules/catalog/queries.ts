import { and, asc, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';

import { getDb, type Database } from '@/server/db/client';
import {
  brands,
  brandTranslations,
  categories,
  categoryTranslations,
  collections,
  collectionTranslations,
  fragranceFamilies,
  fragranceFamilyTranslations,
  fragranceNoteTranslations,
  media,
  mediaTranslations,
  productCategories,
  productFamilies,
  productMedia,
  productNotes,
  productTranslations,
  productVariants,
} from '@/server/db/schema';
import { availableQuantitySql, getVariantAvailability } from '@/server/modules/inventory';

import {
  listingQuerySchema,
  productSlugQuerySchema,
  suggestionsQuerySchema,
  type ListingQuery,
  type ListingQueryInput,
} from './schemas';
import { normalizeSearchQuery, toPrefixTsQuery } from './search-terms';
import {
  CONCENTRATIONS,
  NOTE_LAYERS,
  type BrandListItem,
  type BrandPage,
  type CatalogLocale,
  type Concentration,
  type FacetOption,
  type Gender,
  type ListingFacets,
  type ListingResult,
  type MediaImage,
  type NoteLayer,
  type ProductDetail,
  type ProductNoteRef,
  type ProductSummary,
  type RichTextDoc,
  type SearchSuggestions,
  type SellableVariantType,
  type TaxonomyPage,
  type VariantOffer,
} from './types';

/*
 * Storefront read queries (ARCHITECTURE.md §10.1, §10.2, §14.1).
 *
 * Visibility rules, applied by every query:
 * - products: status = 'active', not soft-deleted, published_at not in the future;
 * - the translation for the requested locale exists and is_published (English is hidden until
 *   an editor publishes it, ADR-0021); brands: status = 'active', not soft-deleted;
 * - variants: is_active and never variant_type = 'decant' (ADR-0015); a product without a
 *   sellable variant does not appear in listings.
 *
 * Performance: one SQL statement per listing (items + facets + total via CTEs), filters on
 * indexed keys, no per-row queries. Results are cached by the Next-only layer
 * (src/server/catalog-cache.ts); nothing here imports Next.js (ADR-0023).
 */

type Executor = Pick<Database, 'execute'>;

const FUZZY_THRESHOLD = 0.35;
const NOTE_FACET_LIMIT = 24;

// ---------- SQL helpers ----------

function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

function uuidArray(values: readonly string[]): SQL {
  return values.length === 0 ? sql`array[]::uuid[]` : sql`array[${list(values)}]::uuid[]`;
}

/** Visibility of a product row `p` with translation `pt` and brand `b` (see header). */
function productVisibleSql(): SQL {
  return sql`p.status = 'active' and p.deleted_at is null
    and (p.published_at is null or p.published_at <= now())
    and pt.is_published
    and b.status = 'active' and b.deleted_at is null`;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function asRichText(value: unknown): RichTextDoc | null {
  return value && typeof value === 'object' && 'type' in value ? (value as RichTextDoc) : null;
}

// ---------- Listings ----------

/** Internal scope used by featured/related rails: an explicit, ordered set of products. */
type InternalScope = ListingQuery['scope'] | { kind: 'ids'; ids: string[] };

type ListingRow = {
  items: Array<Record<string, unknown>> | null;
  facets: Array<{ facet: string; value: string; label: string; count: number }> | null;
  total: number | null;
};

function scopeCondition(scope: InternalScope): SQL {
  switch (scope.kind) {
    case 'all':
      return sql`true`;
    case 'brand':
      return sql`p.brand_id = ${scope.id}`;
    case 'category':
      // Includes sub-categories.
      return sql`exists (
        select 1 from product_categories pc
        where pc.product_id = p.id and pc.category_id in (
          with recursive tree as (
            select c.id from categories c where c.id = ${scope.id} and c.deleted_at is null
            union all
            select c.id from categories c join tree on c.parent_id = tree.id
            where c.deleted_at is null
          )
          select id from tree
        )
      )`;
    case 'collection':
      // Manual collections only; rule-based collections need a rules format (stream B).
      return sql`exists (
        select 1 from collection_products cp
        where cp.product_id = p.id and cp.collection_id = ${scope.id}
      )`;
    case 'family':
      return sql`exists (
        select 1 from product_families pf where pf.product_id = p.id and pf.family_id = ${scope.id}
      )`;
    case 'ids':
      return scope.ids.length === 0 ? sql`false` : sql`p.id = any(${uuidArray(scope.ids)})`;
  }
}

function scopePosition(scope: InternalScope): SQL {
  if (scope.kind === 'collection') {
    return sql`(select cp.position from collection_products cp
      where cp.product_id = p.id and cp.collection_id = ${scope.id})`;
  }
  if (scope.kind === 'ids') return sql`array_position(${uuidArray(scope.ids)}, p.id)`;
  return sql`null::int`;
}

function orderBy(sort: ListingQuery['sort'], hasSearch: boolean): SQL {
  const featured = sql`scope_position asc nulls last, is_featured desc, published_at desc nulls last, id desc`;
  const sales = sql`sales_rank asc nulls last, ${featured}`;
  switch (sort) {
    case 'newest':
      return sql`published_at desc nulls last, created_at desc, id desc`;
    case 'price_asc':
      return sql`match_min_price asc, id desc`;
    case 'price_desc':
      return sql`match_min_price desc, id desc`;
    case 'relevance':
      return hasSearch ? sql`rank desc, ${featured}` : featured;
    case 'best_selling':
      // Ranked ids come from the order module (`salesRank`); unranked products follow in
      // featured order, so a shop without sales still gets a sensible list.
      return sales;
    case 'featured':
      return featured;
  }
}

function buildListingSql(
  query: ListingQuery,
  scope: InternalScope,
  search: { tsQuery: string | null; fuzzyText: string | null; genders: Gender[] },
  withFacets: boolean,
  salesRank: readonly string[] = [],
): SQL {
  const { locale, filters } = query;
  const salesRankSql =
    query.sort === 'best_selling' && salesRank.length > 0
      ? sql`array_position(${uuidArray(salesRank)}, p.id)`
      : sql`null::int`;

  let searchCondition = sql`true`;
  let rank = sql`0::real`;
  if (search.tsQuery) {
    searchCondition = sql`pt.search_vector @@ to_tsquery('simple', ${search.tsQuery})`;
    rank = sql`ts_rank(pt.search_vector, to_tsquery('simple', ${search.tsQuery}))`;
  } else if (search.fuzzyText) {
    const haystack = sql`immutable_unaccent(lower(b.name || ' ' || pt.name))`;
    searchCondition = sql`word_similarity(${search.fuzzyText}, ${haystack}) >= ${FUZZY_THRESHOLD}`;
    rank = sql`word_similarity(${search.fuzzyText}, ${haystack})`;
  }
  // Gender words in the query ("nước hoa nam") narrow like a filter.
  const searchGender =
    search.genders.length > 0 ? sql`p.gender::text in (${list(search.genders)})` : sql`true`;

  const priceOk =
    filters.minPrice === null && filters.maxPrice === null
      ? sql`true`
      : sql`x.price between ${filters.minPrice ?? 0} and ${filters.maxPrice ?? Number.MAX_SAFE_INTEGER}`;
  const typeOk =
    filters.types.length > 0 ? sql`x.variant_type in (${list(filters.types)})` : sql`true`;
  const stockOk = filters.inStock ? sql`x.available > 0` : sql`true`;

  const brandOk =
    filters.brands.length > 0 ? sql`brand_slug in (${list(filters.brands)})` : sql`true`;
  const genderOk =
    filters.genders.length > 0 ? sql`gender in (${list(filters.genders)})` : sql`true`;
  const concentrationOk =
    filters.concentrations.length > 0
      ? sql`concentration in (${list(filters.concentrations)})`
      : sql`true`;
  const familyOk =
    filters.families.length > 0
      ? sql`exists (
          select 1 from product_families pf
          join fragrance_family_translations ft on ft.family_id = pf.family_id and ft.locale = ${locale}
          where pf.product_id = base.id and ft.slug in (${list(filters.families)})
        )`
      : sql`true`;
  const noteOk =
    filters.notes.length > 0
      ? sql`exists (
          select 1 from product_notes pn
          join fragrance_note_translations nt on nt.note_id = pn.note_id and nt.locale = ${locale}
          where pn.product_id = base.id and nt.slug in (${list(filters.notes)})
        )`
      : sql`true`;

  const offset = (query.page - 1) * query.pageSize;
  const hasSearch = Boolean(search.tsQuery || search.fuzzyText);

  const facetsSql = withFacets
    ? sql`(
        select coalesce(json_agg(fc), '[]'::json) from (
          select 'brand' as facet, brand_slug as value, brand_name as label, count(*)::int as count
          from flags where brand_slug is not null and f_gender and f_conc and f_family and f_note and f_variant
          group by brand_slug, brand_name
          union all
          select 'gender', gender, gender, count(*)::int
          from flags where f_brand and f_conc and f_family and f_note and f_variant
          group by gender
          union all
          select 'concentration', concentration, concentration, count(*)::int
          from flags where f_brand and f_gender and f_family and f_note and f_variant
          group by concentration
          union all
          select 'family', ft.slug, ft.name, count(distinct flags.id)::int
          from flags
          join product_families pf on pf.product_id = flags.id
          join fragrance_family_translations ft on ft.family_id = pf.family_id and ft.locale = ${locale}
          where f_brand and f_gender and f_conc and f_note and f_variant
          group by ft.slug, ft.name
          union all
          (select 'note', nt.slug, nt.name, count(distinct flags.id)::int
          from flags
          join product_notes pn on pn.product_id = flags.id
          join fragrance_note_translations nt on nt.note_id = pn.note_id and nt.locale = ${locale}
          where f_brand and f_gender and f_conc and f_family and f_variant
          group by nt.slug, nt.name
          order by count(distinct flags.id) desc, nt.name
          limit ${NOTE_FACET_LIMIT})
          union all
          select 'type', vf.variant_type, vf.variant_type, count(distinct vf.product_id)::int
          from vflags vf join flags on flags.id = vf.product_id
          where f_brand and f_gender and f_conc and f_family and f_note and vf.price_ok and vf.stock_ok
          group by vf.variant_type
          union all
          select 'in_stock', 'true', 'true', count(*)::int
          from flags where f_brand and f_gender and f_conc and f_family and f_note and f_in_stock
        ) fc
      )`
    : sql`null::json`;

  return sql`
    with base as (
      select p.id, p.brand_id, p.gender::text as gender, p.concentration::text as concentration,
        p.is_featured, p.published_at, p.created_at, p.rating_avg, p.rating_count,
        pt.name, pt.slug, pt.subtitle, b.name as brand_name, bt.slug as brand_slug,
        ${rank} as rank, ${scopePosition(scope)} as scope_position, ${salesRankSql} as sales_rank
      from products p
      join product_translations pt on pt.product_id = p.id and pt.locale = ${locale}
      join brands b on b.id = p.brand_id
      left join brand_translations bt
        on bt.brand_id = b.id and bt.locale = ${locale} and bt.is_published
      where ${productVisibleSql()} and ${scopeCondition(scope)} and ${searchCondition} and ${searchGender}
    ),
    vflags as (
      select x.*, ${priceOk} as price_ok, ${typeOk} as type_ok, ${stockOk} as stock_ok
      from (
        select v.id, v.product_id, v.price, v.compare_at_price, v.variant_type::text as variant_type,
          ${availableQuantitySql(sql`v.id`)} as available
        from product_variants v
        where v.product_id in (select id from base) and v.is_active and v.variant_type <> 'decant'
      ) x
    ),
    agg as (
      select product_id,
        bool_or(price_ok and type_ok and stock_ok) as f_variant,
        bool_or(price_ok and type_ok and available > 0) as f_in_stock,
        min(price) filter (where price_ok and type_ok and stock_ok) as match_min_price,
        (array_agg(compare_at_price order by price) filter (where price_ok and type_ok and stock_ok))[1]
          as match_compare_at,
        min(price) as min_price, max(price) as max_price, count(*)::int as variant_count
      from vflags group by product_id
    ),
    flags as (
      select base.*, agg.f_variant, agg.f_in_stock, agg.match_min_price, agg.match_compare_at,
        agg.min_price, agg.max_price, agg.variant_count,
        ${brandOk} as f_brand, ${genderOk} as f_gender, ${concentrationOk} as f_conc,
        ${familyOk} as f_family, ${noteOk} as f_note
      from base join agg on agg.product_id = base.id
    ),
    filtered as (
      select * from flags where f_brand and f_gender and f_conc and f_family and f_note and f_variant
    ),
    page as (
      select filtered.*, row_number() over (order by ${orderBy(query.sort, hasSearch)}) as rn
      from filtered
      order by ${orderBy(query.sort, hasSearch)}
      limit ${query.pageSize} offset ${offset}
    )
    select
      (select count(*)::int from filtered) as total,
      (
        select coalesce(json_agg(json_build_object(
          'id', page.id, 'slug', page.slug, 'name', page.name, 'subtitle', page.subtitle,
          'brandId', page.brand_id, 'brandName', page.brand_name, 'brandSlug', page.brand_slug,
          'concentration', page.concentration, 'gender', page.gender,
          'fromPrice', page.match_min_price, 'fromCompareAtPrice', page.match_compare_at,
          'minPrice', page.min_price, 'maxPrice', page.max_price,
          'variantCount', page.variant_count,
          'ratingAvg', page.rating_avg, 'ratingCount', page.rating_count,
          'images', img.images
        ) order by page.rn), '[]'::json)
        from page
        left join lateral (
          select coalesce(json_agg(json_build_object(
            'id', m.id, 'storageKey', m.storage_key, 'url', m.url, 'width', m.width,
            'height', m.height, 'blurDataUrl', m.blur_data_url, 'alt', coalesce(mt.alt, ''),
            'variantId', x.variant_id
          ) order by x.position, x.media_id), '[]'::json) as images
          from (
            select pm.media_id, pm.variant_id, pm.position from product_media pm
            where pm.product_id = page.id order by pm.position, pm.media_id limit 2
          ) x
          join media m on m.id = x.media_id
          left join media_translations mt on mt.media_id = m.id and mt.locale = ${locale}
        ) img on true
      ) as items,
      ${facetsSql} as facets
  `;
}

function mapSummary(row: Record<string, unknown>): ProductSummary {
  const minPrice = toNumber(row.minPrice);
  const maxPrice = toNumber(row.maxPrice);
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    subtitle: (row.subtitle as string | null) ?? null,
    brand: {
      id: String(row.brandId),
      name: String(row.brandName),
      slug: (row.brandSlug as string | null) ?? '',
    },
    concentration: row.concentration as Concentration,
    gender: row.gender as Gender,
    fromPrice: toNumber(row.fromPrice ?? row.minPrice),
    fromCompareAtPrice: toNullableNumber(row.fromCompareAtPrice),
    hasPriceRange: minPrice !== maxPrice,
    variantCount: toNumber(row.variantCount),
    images: ((row.images as MediaImage[] | null) ?? []).map(mapImage),
    ratingAvg: toNumber(row.ratingAvg),
    ratingCount: toNumber(row.ratingCount),
  };
}

function mapImage(image: MediaImage): MediaImage {
  return {
    id: image.id,
    storageKey: image.storageKey,
    url: image.url,
    width: image.width ?? null,
    height: image.height ?? null,
    blurDataUrl: image.blurDataUrl ?? null,
    alt: image.alt ?? '',
    variantId: image.variantId ?? null,
  };
}

const FACET_KEYS = {
  brand: 'brands',
  gender: 'genders',
  concentration: 'concentrations',
  family: 'families',
  note: 'notes',
  type: 'types',
} as const satisfies Record<string, Exclude<keyof ListingFacets, 'inStock'>>;

function mapFacets(rows: ListingRow['facets']): ListingFacets {
  const facets: ListingFacets = {
    brands: [],
    genders: [],
    families: [],
    notes: [],
    concentrations: [],
    types: [],
    inStock: 0,
  };
  for (const row of rows ?? []) {
    if (row.facet === 'in_stock') {
      facets.inStock = row.count;
      continue;
    }
    const key = FACET_KEYS[row.facet as keyof typeof FACET_KEYS];
    if (key) facets[key].push({ value: row.value, label: row.label, count: row.count });
  }
  const byLabel = (a: FacetOption, b: FacetOption) => a.label.localeCompare(b.label);
  facets.brands.sort(byLabel);
  facets.families.sort(byLabel);
  facets.notes.sort(byLabel);
  facets.concentrations.sort(
    (a, b) =>
      CONCENTRATIONS.indexOf(a.value as Concentration) -
      CONCENTRATIONS.indexOf(b.value as Concentration),
  );
  return facets;
}

async function runListing(
  db: Executor,
  query: ListingQuery,
  scope: InternalScope,
  withFacets: boolean,
  salesRank: readonly string[] = [],
): Promise<ListingResult> {
  const normalized = normalizeSearchQuery(query.q);
  const tsQuery = toPrefixTsQuery(normalized.terms);

  const execute = async (search: Parameters<typeof buildListingSql>[2]) => {
    const result = await db.execute<ListingRow>(
      buildListingSql(query, scope, search, withFacets, salesRank),
    );
    return result.rows[0] ?? { items: [], facets: [], total: 0 };
  };

  let fuzzy = false;
  let row = await execute({ tsQuery, fuzzyText: null, genders: normalized.genders });
  // Typo tolerance (§10.1): when full-text finds nothing, fall back to trigram similarity.
  if (tsQuery && (row.total ?? 0) === 0) {
    fuzzy = true;
    row = await execute({
      tsQuery: null,
      fuzzyText: normalized.terms.join(' '),
      genders: normalized.genders,
    });
  }

  const total = row.total ?? 0;
  return {
    items: (row.items ?? []).map(mapSummary),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    facets: mapFacets(row.facets),
    searchTerms: normalized.terms,
    fuzzy,
  };
}

/**
 * Product listing with filters, sort, pagination and disjunctive facet counts (each facet is
 * counted with every other filter applied). Also used for search (`q`).
 *
 * `options.salesRank`: product ids ranked by units sold (order module,
 * `listBestSellingProductIds`), used by the `best_selling` sort; the catalogue does not read
 * order tables itself.
 */
export async function getProductListing(
  input: ListingQueryInput,
  dbOverride?: Executor,
  options: { salesRank?: readonly string[] } = {},
): Promise<ListingResult> {
  const query = listingQuerySchema.parse(input);
  return runListing(dbOverride ?? getDb(), query, query.scope, true, options.salesRank ?? []);
}

/** Featured products for the home page (featured first, then newest). */
export async function getFeaturedProducts(
  locale: CatalogLocale,
  limit = 8,
  dbOverride?: Executor,
): Promise<ProductSummary[]> {
  const query = listingQuerySchema.parse({ locale, pageSize: Math.min(limit, 24) });
  return (await runListing(dbOverride ?? getDb(), query, query.scope, false)).items;
}

/** Newest visible products (home "New arrivals" rail, §2 Discovery). */
export async function getNewestProducts(
  locale: CatalogLocale,
  limit = 8,
  dbOverride?: Executor,
): Promise<ProductSummary[]> {
  const query = listingQuerySchema.parse({ locale, sort: 'newest', pageSize: Math.min(limit, 24) });
  return (await runListing(dbOverride ?? getDb(), query, query.scope, false)).items;
}

/** Up to `limit` visible products in the given order (unknown or hidden ids are skipped). */
export async function getProductSummariesByIds(
  locale: CatalogLocale,
  ids: readonly string[],
  dbOverride?: Executor,
): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];
  const query = listingQuerySchema.parse({ locale, pageSize: Math.min(ids.length, 60) });
  return (await runListing(dbOverride ?? getDb(), query, { kind: 'ids', ids: [...ids] }, false))
    .items;
}

/** Same brand or shared scent family first; excludes the product itself. */
export async function getRelatedProducts(
  locale: CatalogLocale,
  productId: string,
  limit = 4,
  dbOverride?: Database,
): Promise<ProductSummary[]> {
  const db = dbOverride ?? getDb();
  const result = await db.execute<{ id: string }>(sql`
    select p.id
    from products p
    join product_translations pt on pt.product_id = p.id and pt.locale = ${locale}
    join brands b on b.id = p.brand_id
    cross join (select brand_id, product_line_id from products where id = ${productId}) self
    where ${productVisibleSql()} and p.id <> ${productId}
      and (p.product_line_id is distinct from self.product_line_id or self.product_line_id is null)
      and exists (
        select 1 from product_variants v
        where v.product_id = p.id and v.is_active and v.variant_type <> 'decant'
      )
    order by
      (select count(*) from product_families a join product_families o on o.family_id = a.family_id
        where a.product_id = p.id and o.product_id = ${productId}) desc,
      (p.brand_id = self.brand_id) desc,
      p.is_featured desc, p.published_at desc nulls last, p.id desc
    limit ${limit}
  `);
  return getProductSummariesByIds(
    locale,
    result.rows.map((row) => row.id),
    db,
  );
}

// ---------- Search suggestions ----------

/** 6 products + 3 brands for the search dialog (§10.1). */
export async function getSearchSuggestions(
  input: { locale: CatalogLocale; q: string },
  dbOverride?: Executor,
): Promise<SearchSuggestions> {
  const { locale, q } = suggestionsQuerySchema.parse(input);
  const normalized = normalizeSearchQuery(q);
  if (normalized.terms.length === 0 && normalized.genders.length === 0) {
    return { products: [], brands: [] };
  }
  const db = dbOverride ?? getDb();

  const listingQuery = listingQuerySchema.parse({ locale, q, sort: 'relevance', pageSize: 6 });
  const brandMatch =
    normalized.terms.length === 0
      ? sql`false`
      : sql`(${sql.join(
          normalized.terms.map(
            (term) => sql`immutable_unaccent(lower(b.name)) like ${`%${term}%`}`,
          ),
          sql` and `,
        )}) or word_similarity(${normalized.terms.join(' ')}, immutable_unaccent(lower(b.name))) >= ${FUZZY_THRESHOLD}`;

  const [listing, brandRows] = await Promise.all([
    runListing(db, listingQuery, { kind: 'all' }, false),
    db.execute<{ id: string; name: string; slug: string }>(sql`
      select b.id, b.name, bt.slug
      from brands b
      join brand_translations bt on bt.brand_id = b.id and bt.locale = ${locale} and bt.is_published
      where b.status = 'active' and b.deleted_at is null and (${brandMatch})
      order by b.is_featured desc, b.name
      limit 3
    `),
  ]);

  return {
    products: listing.items.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      brand: item.brand,
      concentration: item.concentration,
      fromPrice: item.fromPrice,
      hasPriceRange: item.hasPriceRange,
      images: item.images.slice(0, 1),
    })),
    brands: brandRows.rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug })),
  };
}

// ---------- Product detail ----------

async function visibleLocaleSlugs(
  db: Database,
  productId: string,
): Promise<Partial<Record<CatalogLocale, string>>> {
  const rows = await db
    .select({ locale: productTranslations.locale, slug: productTranslations.slug })
    .from(productTranslations)
    .where(
      and(eq(productTranslations.productId, productId), eq(productTranslations.isPublished, true)),
    );
  return Object.fromEntries(rows.map((row) => [row.locale, row.slug]));
}

/** Product page data by slug in one locale; null when missing or not visible there. */
export async function getProductDetail(
  input: { locale: CatalogLocale; slug: string },
  dbOverride?: Database,
): Promise<ProductDetail | null> {
  const parsed = productSlugQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug } = parsed.data;
  const db = dbOverride ?? getDb();

  const core = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.gender::text as gender, p.concentration::text as concentration,
      p.release_year, p.perfumer, p.longevity, p.sillage, p.seasons, p.occasions,
      p.rating_avg, p.rating_count, p.country_of_origin, p.cosmetic_notification_no,
      p.responsible_importer, p.ingredients, p.warnings, p.updated_at,
      pt.name, pt.slug, pt.subtitle, pt.description, pt.seo_title, pt.seo_description,
      pt.updated_at as translation_updated_at,
      b.id as brand_id, b.name as brand_name, b.country as brand_country,
      bt.slug as brand_slug, bt.story as brand_story,
      pl.id as line_id, pl.name as line_name
    from product_translations pt
    join products p on p.id = pt.product_id
    join brands b on b.id = p.brand_id
    left join brand_translations bt
      on bt.brand_id = b.id and bt.locale = ${locale} and bt.is_published
    left join product_lines pl on pl.id = p.product_line_id
    where pt.locale = ${locale} and pt.slug = ${slug} and ${productVisibleSql()}
    limit 1
  `);
  const row = core.rows[0];
  if (!row) return null;
  const productId = String(row.id);
  const lineId = (row.line_id as string | null) ?? null;

  const [variantRows, imageRows, noteRows, familyRows, categoryRows, siblingRows, localeSlugs] =
    await Promise.all([
      db
        .select({
          id: productVariants.id,
          sku: productVariants.sku,
          barcode: productVariants.barcode,
          sizeMl: productVariants.sizeMl,
          variantType: productVariants.variantType,
          price: productVariants.price,
          compareAtPrice: productVariants.compareAtPrice,
          isDefault: productVariants.isDefault,
        })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, productId),
            eq(productVariants.isActive, true),
            ne(productVariants.variantType, 'decant'),
          ),
        )
        .orderBy(asc(productVariants.position), desc(productVariants.sizeMl)),
      db
        .select({
          id: media.id,
          storageKey: media.storageKey,
          url: media.url,
          width: media.width,
          height: media.height,
          blurDataUrl: media.blurDataUrl,
          alt: mediaTranslations.alt,
          variantId: productMedia.variantId,
        })
        .from(productMedia)
        .innerJoin(media, eq(media.id, productMedia.mediaId))
        .leftJoin(
          mediaTranslations,
          and(eq(mediaTranslations.mediaId, media.id), eq(mediaTranslations.locale, locale)),
        )
        .where(eq(productMedia.productId, productId))
        .orderBy(asc(productMedia.position), asc(productMedia.mediaId)),
      db
        .select({
          id: fragranceNoteTranslations.noteId,
          name: fragranceNoteTranslations.name,
          slug: fragranceNoteTranslations.slug,
          layer: productNotes.layer,
        })
        .from(productNotes)
        .innerJoin(
          fragranceNoteTranslations,
          and(
            eq(fragranceNoteTranslations.noteId, productNotes.noteId),
            eq(fragranceNoteTranslations.locale, locale),
          ),
        )
        .where(eq(productNotes.productId, productId))
        .orderBy(asc(productNotes.layer), asc(productNotes.position)),
      db
        .select({
          id: fragranceFamilyTranslations.familyId,
          name: fragranceFamilyTranslations.name,
          slug: fragranceFamilyTranslations.slug,
          isPrimary: productFamilies.isPrimary,
        })
        .from(productFamilies)
        .innerJoin(
          fragranceFamilyTranslations,
          and(
            eq(fragranceFamilyTranslations.familyId, productFamilies.familyId),
            eq(fragranceFamilyTranslations.locale, locale),
          ),
        )
        .where(eq(productFamilies.productId, productId))
        .orderBy(desc(productFamilies.isPrimary), asc(fragranceFamilyTranslations.name)),
      db
        .select({
          id: categories.id,
          name: categoryTranslations.name,
          slug: categoryTranslations.slug,
        })
        .from(productCategories)
        .innerJoin(categories, eq(categories.id, productCategories.categoryId))
        .innerJoin(
          categoryTranslations,
          and(
            eq(categoryTranslations.categoryId, categories.id),
            eq(categoryTranslations.locale, locale),
            eq(categoryTranslations.isPublished, true),
          ),
        )
        .where(and(eq(productCategories.productId, productId), isNull(categories.deletedAt)))
        .orderBy(asc(categories.sortOrder), asc(categoryTranslations.name)),
      lineId
        ? db.execute<{ id: string; slug: string; name: string; concentration: string }>(sql`
            select p.id, pt.slug, pt.name, p.concentration::text as concentration
            from products p
            join product_translations pt on pt.product_id = p.id and pt.locale = ${locale}
            join brands b on b.id = p.brand_id
            where p.product_line_id = ${lineId} and ${productVisibleSql()}
            order by p.concentration, pt.name
          `)
        : Promise.resolve({
            rows: [] as { id: string; slug: string; name: string; concentration: string }[],
          }),
      visibleLocaleSlugs(db, productId),
    ]);

  const notes = Object.fromEntries(NOTE_LAYERS.map((layer) => [layer, []])) as unknown as Record<
    NoteLayer,
    ProductNoteRef[]
  >;
  for (const note of noteRows)
    notes[note.layer].push({ id: note.id, name: note.name, slug: note.slug });

  const updatedAt = [row.updated_at, row.translation_updated_at]
    .map((value) => new Date(value as string | Date).getTime())
    .reduce((a, b) => Math.max(a, b), 0);

  return {
    id: productId,
    locale,
    slug: String(row.slug),
    name: String(row.name),
    subtitle: (row.subtitle as string | null) ?? null,
    description: asRichText(row.description),
    seoTitle: (row.seo_title as string | null) ?? null,
    seoDescription: (row.seo_description as string | null) ?? null,
    brand: {
      id: String(row.brand_id),
      name: String(row.brand_name),
      slug: (row.brand_slug as string | null) ?? '',
      country: (row.brand_country as string | null) ?? null,
      story: asRichText(row.brand_story),
    },
    productLine: lineId ? { id: lineId, name: String(row.line_name) } : null,
    siblings: siblingRows.rows.map((sibling) => ({
      id: sibling.id,
      slug: sibling.slug,
      name: sibling.name,
      concentration: sibling.concentration as Concentration,
      isCurrent: sibling.id === productId,
    })),
    concentration: row.concentration as Concentration,
    gender: row.gender as Gender,
    releaseYear: toNullableNumber(row.release_year),
    perfumer: (row.perfumer as string | null) ?? null,
    longevity: toNullableNumber(row.longevity),
    sillage: toNullableNumber(row.sillage),
    seasons: (row.seasons as string[] | null) ?? [],
    occasions: (row.occasions as string[] | null) ?? [],
    ratingAvg: toNumber(row.rating_avg),
    ratingCount: toNumber(row.rating_count),
    compliance: {
      countryOfOrigin: (row.country_of_origin as string | null) ?? null,
      cosmeticNotificationNo: (row.cosmetic_notification_no as string | null) ?? null,
      responsibleImporter: (row.responsible_importer as string | null) ?? null,
      ingredients: (row.ingredients as string | null) ?? null,
      warnings: (row.warnings as string | null) ?? null,
    },
    variants: variantRows.map((variant) => ({
      ...variant,
      variantType: variant.variantType as SellableVariantType,
    })),
    images: imageRows.map((image) => mapImage({ ...image, alt: image.alt ?? '' })),
    notes,
    families: familyRows,
    categories: categoryRows,
    localeSlugs,
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

/**
 * Live price and availability for a product's sellable variants. Never cache this: the PDP
 * renders it in a dynamic island (§14.1).
 */
export async function getVariantOffers(
  productId: string,
  dbOverride?: Database,
): Promise<VariantOffer[]> {
  const db = dbOverride ?? getDb();
  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      price: productVariants.price,
      compareAtPrice: productVariants.compareAtPrice,
    })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        eq(productVariants.isActive, true),
        ne(productVariants.variantType, 'decant'),
      ),
    )
    .orderBy(asc(productVariants.position));
  const availability = await getVariantAvailability(
    variants.map((variant) => variant.id),
    db,
  );
  return variants.map((variant) => {
    const stock = availability.get(variant.id);
    return {
      variantId: variant.id,
      sku: variant.sku,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      available: stock?.available ?? 0,
      stockState: stock?.stockState ?? 'out_of_stock',
    };
  });
}

// ---------- Brands ----------

/** Brands A–Z visible in a locale, with their number of visible products. */
export async function getBrandList(
  locale: CatalogLocale,
  dbOverride?: Database,
): Promise<BrandListItem[]> {
  const db = dbOverride ?? getDb();
  const result = await db.execute<Record<string, unknown>>(sql`
    select b.id, b.name, bt.slug, b.country, b.is_featured,
      (
        select count(*)::int from products p
        join product_translations pt on pt.product_id = p.id and pt.locale = ${locale}
        where p.brand_id = b.id and p.status = 'active' and p.deleted_at is null
          and (p.published_at is null or p.published_at <= now()) and pt.is_published
          and exists (
            select 1 from product_variants v
            where v.product_id = p.id and v.is_active and v.variant_type <> 'decant'
          )
      ) as product_count,
      case when m.id is null then null else json_build_object(
        'id', m.id, 'storageKey', m.storage_key, 'url', m.url, 'width', m.width,
        'height', m.height, 'blurDataUrl', m.blur_data_url, 'alt', coalesce(mt.alt, ''),
        'variantId', null
      ) end as logo
    from brands b
    join brand_translations bt on bt.brand_id = b.id and bt.locale = ${locale} and bt.is_published
    left join media m on m.id = b.logo_media_id
    left join media_translations mt on mt.media_id = m.id and mt.locale = ${locale}
    where b.status = 'active' and b.deleted_at is null
    order by immutable_unaccent(lower(b.name))
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    country: (row.country as string | null) ?? null,
    isFeatured: Boolean(row.is_featured),
    productCount: toNumber(row.product_count),
    logo: row.logo ? mapImage(row.logo as MediaImage) : null,
  }));
}

export async function getBrandBySlug(
  input: { locale: CatalogLocale; slug: string },
  dbOverride?: Database,
): Promise<BrandPage | null> {
  const parsed = productSlugQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug } = parsed.data;
  const db = dbOverride ?? getDb();

  const [row] = await db
    .select({
      id: brands.id,
      name: brands.name,
      country: brands.country,
      slug: brandTranslations.slug,
      story: brandTranslations.story,
      seoTitle: brandTranslations.seoTitle,
      seoDescription: brandTranslations.seoDescription,
      logo: {
        id: media.id,
        storageKey: media.storageKey,
        url: media.url,
        width: media.width,
        height: media.height,
        blurDataUrl: media.blurDataUrl,
      },
    })
    .from(brandTranslations)
    .innerJoin(brands, eq(brands.id, brandTranslations.brandId))
    .leftJoin(media, eq(media.id, brands.logoMediaId))
    .where(
      and(
        eq(brandTranslations.locale, locale),
        eq(brandTranslations.slug, slug),
        eq(brandTranslations.isPublished, true),
        eq(brands.status, 'active'),
        isNull(brands.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const slugs = await db
    .select({ locale: brandTranslations.locale, slug: brandTranslations.slug })
    .from(brandTranslations)
    .where(and(eq(brandTranslations.brandId, row.id), eq(brandTranslations.isPublished, true)));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    country: row.country,
    story: asRichText(row.story),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    logo: row.logo?.id
      ? mapImage({ ...row.logo, alt: row.name, variantId: null } as MediaImage)
      : null,
    localeSlugs: Object.fromEntries(slugs.map((s) => [s.locale, s.slug])),
  };
}

/** Brands flagged as featured (home page rail). */
export async function getFeaturedBrands(
  locale: CatalogLocale,
  limit = 12,
  dbOverride?: Database,
): Promise<BrandListItem[]> {
  const all = await getBrandList(locale, dbOverride);
  return all.filter((brand) => brand.isFeatured && brand.productCount > 0).slice(0, limit);
}

// ---------- Categories, collections, scent families ----------

export async function getCategoryBySlug(
  input: { locale: CatalogLocale; slug: string },
  dbOverride?: Database,
): Promise<TaxonomyPage | null> {
  const parsed = productSlugQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug } = parsed.data;
  const db = dbOverride ?? getDb();
  const [row] = await db
    .select({
      id: categories.id,
      name: categoryTranslations.name,
      slug: categoryTranslations.slug,
      description: categoryTranslations.description,
      seoTitle: categoryTranslations.seoTitle,
      seoDescription: categoryTranslations.seoDescription,
    })
    .from(categoryTranslations)
    .innerJoin(categories, eq(categories.id, categoryTranslations.categoryId))
    .where(
      and(
        eq(categoryTranslations.locale, locale),
        eq(categoryTranslations.slug, slug),
        eq(categoryTranslations.isPublished, true),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const slugs = await db
    .select({ locale: categoryTranslations.locale, slug: categoryTranslations.slug })
    .from(categoryTranslations)
    .where(
      and(eq(categoryTranslations.categoryId, row.id), eq(categoryTranslations.isPublished, true)),
    );
  return {
    ...row,
    kind: 'category',
    localeSlugs: Object.fromEntries(slugs.map((s) => [s.locale, s.slug])),
  };
}

export async function getCollectionBySlug(
  input: { locale: CatalogLocale; slug: string },
  dbOverride?: Database,
): Promise<TaxonomyPage | null> {
  const parsed = productSlugQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug } = parsed.data;
  const db = dbOverride ?? getDb();
  const activeWindow = sql`(${collections.startsAt} is null or ${collections.startsAt} <= now())
    and (${collections.endsAt} is null or ${collections.endsAt} > now())`;
  const [row] = await db
    .select({
      id: collections.id,
      name: collectionTranslations.name,
      slug: collectionTranslations.slug,
      description: collectionTranslations.description,
      seoTitle: collectionTranslations.seoTitle,
      seoDescription: collectionTranslations.seoDescription,
    })
    .from(collectionTranslations)
    .innerJoin(collections, eq(collections.id, collectionTranslations.collectionId))
    .where(
      and(
        eq(collectionTranslations.locale, locale),
        eq(collectionTranslations.slug, slug),
        eq(collectionTranslations.isPublished, true),
        eq(collections.isActive, true),
        activeWindow,
      ),
    )
    .limit(1);
  if (!row) return null;
  const slugs = await db
    .select({ locale: collectionTranslations.locale, slug: collectionTranslations.slug })
    .from(collectionTranslations)
    .where(
      and(
        eq(collectionTranslations.collectionId, row.id),
        eq(collectionTranslations.isPublished, true),
      ),
    );
  return {
    ...row,
    kind: 'collection',
    localeSlugs: Object.fromEntries(slugs.map((s) => [s.locale, s.slug])),
  };
}

/** Scent families have no `is_published`: a translation row in the locale makes it visible. */
export async function getFamilyBySlug(
  input: { locale: CatalogLocale; slug: string },
  dbOverride?: Database,
): Promise<TaxonomyPage | null> {
  const parsed = productSlugQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug } = parsed.data;
  const db = dbOverride ?? getDb();
  const [row] = await db
    .select({
      id: fragranceFamilies.id,
      name: fragranceFamilyTranslations.name,
      slug: fragranceFamilyTranslations.slug,
      description: fragranceFamilyTranslations.description,
    })
    .from(fragranceFamilyTranslations)
    .innerJoin(fragranceFamilies, eq(fragranceFamilies.id, fragranceFamilyTranslations.familyId))
    .where(
      and(
        eq(fragranceFamilyTranslations.locale, locale),
        eq(fragranceFamilyTranslations.slug, slug),
      ),
    )
    .limit(1);
  if (!row) return null;
  const slugs = await db
    .select({
      locale: fragranceFamilyTranslations.locale,
      slug: fragranceFamilyTranslations.slug,
    })
    .from(fragranceFamilyTranslations)
    .where(eq(fragranceFamilyTranslations.familyId, row.id));
  return {
    ...row,
    kind: 'family',
    seoTitle: null,
    seoDescription: null,
    localeSlugs: Object.fromEntries(slugs.map((s) => [s.locale, s.slug])),
  };
}

/** Ids of every product line sibling and family, used for cache tags by the Next layer. */
export function productCacheEntities(product: ProductDetail): {
  productIds: string[];
  brandId: string;
  familyIds: string[];
  categoryIds: string[];
} {
  return {
    productIds: [product.id, ...product.siblings.map((sibling) => sibling.id)],
    brandId: product.brand.id,
    familyIds: product.families.map((family) => family.id),
    categoryIds: product.categories.map((category) => category.id),
  };
}
