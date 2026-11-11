import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { newId } from '@/server/lib/ids';

import { createDb, type Database } from '../client';
import {
  brands,
  brandTranslations,
  categories,
  categoryTranslations,
  fragranceFamilies,
  fragranceFamilyTranslations,
  fragranceNotes,
  fragranceNoteTranslations,
  inventoryItems,
  locations,
  productCategories,
  productFamilies,
  productLines,
  productNotes,
  products,
  productTranslations,
  productVariants,
  provinces,
  settings,
  wards,
} from '../schema';

import { demoCatalog } from './demo-catalog';

type AdminUnits = {
  source: string;
  provinces: { code: string; name: string }[];
  wards: { code: string; provinceCode: string; name: string }[];
};

export function toAscii(value: string): string {
  return value.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function toSlug(value: string): string {
  return toAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function seedAdminUnits(db: Database) {
  const file = join(process.cwd(), 'src/server/db/seed/data/vn-admin-units.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as AdminUnits;

  await db
    .insert(provinces)
    .values(
      data.provinces.map((p) => ({
        code: p.code,
        name: p.name,
        nameAscii: toAscii(p.name),
        slug: toSlug(p.name),
      })),
    )
    .onConflictDoNothing();

  const chunkSize = 1000;
  for (let i = 0; i < data.wards.length; i += chunkSize) {
    await db
      .insert(wards)
      .values(
        data.wards.slice(i, i + chunkSize).map((w) => ({
          code: w.code,
          provinceCode: w.provinceCode,
          name: w.name,
          nameAscii: toAscii(w.name),
          slug: toSlug(w.name),
        })),
      )
      .onConflictDoNothing();
  }
  return { provinces: data.provinces.length, wards: data.wards.length };
}

/** Defaults from ADR-0006 and ADR-0016. Editable later in admin settings. */
export const defaultSettings: Record<string, unknown> = {
  'cod.maxOrderWithoutDeposit': 5_000_000,
  'cod.depositPercent': 20,
  'cod.confirmationWindowHours': 24,
  'checkout.paymentSessionMinutes': 15,
  'checkout.onlineReservationMinutes': 30,
  'cart.maxQuantityPerLine': 5,
  'giftWrap.fee': 50_000,
  'returns.windowDays': 7,
};

async function seedSettings(db: Database) {
  await db
    .insert(settings)
    .values(Object.entries(defaultSettings).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();
}

async function seedDefaultLocation(db: Database): Promise<string> {
  const existing = await db.query.locations.findFirst({
    where: (l, { eq }) => eq(l.isDefault, true),
  });
  if (existing) return existing.id;
  const id = newId();
  await db.insert(locations).values({ id, name: 'Main warehouse', isDefault: true });
  return id;
}

/** Fictional demo catalogue in vi + en. Skipped when products already exist. */
async function seedDemoCatalog(db: Database, locationId: string) {
  const [{ count }] = (
    await db.execute<{ count: number }>(sql`select count(*)::int as count from products`)
  ).rows as [{ count: number }];
  if (count > 0) return { skipped: true, products: 0 };

  const familyIds = new Map<string, string>();
  for (const f of demoCatalog.families) {
    const id = newId();
    familyIds.set(f.key, id);
    await db.insert(fragranceFamilies).values({ id });
    await db.insert(fragranceFamilyTranslations).values([
      { familyId: id, locale: 'vi', name: f.vi, slug: toSlug(f.vi) },
      { familyId: id, locale: 'en', name: f.en, slug: toSlug(f.en) },
    ]);
  }

  const noteIds = new Map<string, string>();
  for (const n of demoCatalog.notes) {
    const id = newId();
    noteIds.set(n.key, id);
    await db.insert(fragranceNotes).values({ id });
    await db.insert(fragranceNoteTranslations).values([
      { noteId: id, locale: 'vi', name: n.vi, slug: toSlug(n.vi) },
      { noteId: id, locale: 'en', name: n.en, slug: toSlug(n.en) },
    ]);
  }

  const categoryIds = new Map<string, string>();
  for (const [index, c] of demoCatalog.categories.entries()) {
    const id = newId();
    categoryIds.set(c.key, id);
    await db.insert(categories).values({ id, sortOrder: index });
    await db.insert(categoryTranslations).values([
      { categoryId: id, locale: 'vi', name: c.vi, slug: toSlug(c.vi), isPublished: true },
      { categoryId: id, locale: 'en', name: c.en, slug: toSlug(c.en), isPublished: true },
    ]);
  }

  let productCount = 0;
  for (const b of demoCatalog.brands) {
    const brandId = newId();
    await db
      .insert(brands)
      .values({
        id: brandId,
        name: b.name,
        country: b.country,
        status: 'active',
        isFeatured: true,
      });
    await db.insert(brandTranslations).values([
      { brandId, locale: 'vi', slug: toSlug(b.name), isPublished: true },
      { brandId, locale: 'en', slug: toSlug(b.name), isPublished: true },
    ]);

    for (const line of b.lines) {
      const lineId = newId();
      await db.insert(productLines).values({ id: lineId, brandId, name: line.name });

      for (const p of line.products) {
        const productId = newId();
        await db.insert(products).values({
          id: productId,
          brandId,
          productLineId: lineId,
          gender: p.gender,
          concentration: p.concentration,
          longevity: p.longevity,
          sillage: p.sillage,
          seasons: p.seasons,
          occasions: p.occasions,
          status: 'active',
          publishedAt: new Date(),
          countryOfOrigin: b.country,
        });
        await db
          .insert(productCategories)
          .values(p.categories.map((key) => ({ productId, categoryId: categoryIds.get(key)! })));
        await db
          .insert(productFamilies)
          .values(
            p.families.map((key, i) => ({
              productId,
              familyId: familyIds.get(key)!,
              isPrimary: i === 0,
            })),
          );
        await db
          .insert(productNotes)
          .values(
            (['top', 'middle', 'base'] as const).flatMap((layer) =>
              p.notes[layer].map((key, position) => ({
                productId,
                noteId: noteIds.get(key)!,
                layer,
                position,
              })),
            ),
          );
        const fullName = `${line.name} ${p.concentration.toUpperCase()}`;
        await db.insert(productTranslations).values([
          {
            productId,
            locale: 'vi',
            name: fullName,
            slug: toSlug(`${b.name} ${fullName}`),
            subtitle: p.subtitle.vi,
            isPublished: true,
          },
          {
            productId,
            locale: 'en',
            name: fullName,
            slug: toSlug(`${b.name} ${fullName}`),
            subtitle: p.subtitle.en,
            isPublished: p.englishPublished,
          },
        ]);
        for (const [position, v] of p.variants.entries()) {
          const variantId = newId();
          await db.insert(productVariants).values({
            id: variantId,
            productId,
            sku: `${toSlug(b.name).slice(0, 4).toUpperCase()}-${toSlug(line.name).slice(0, 4).toUpperCase()}-${p.concentration.toUpperCase()}-${v.sizeMl}`,
            sizeMl: v.sizeMl,
            variantType: v.type,
            price: v.price,
            weightG: v.weightG,
            isDefault: position === 0,
            position,
          });
          await db.insert(inventoryItems).values({ variantId, locationId, onHand: v.stock });
        }
        productCount += 1;
      }
    }
  }
  return { skipped: false, products: productCount };
}

export async function seed(connectionString: string, options: { demo: boolean }) {
  const { db, pool } = createDb(connectionString);
  try {
    const units = await seedAdminUnits(db);
    await seedSettings(db);
    const locationId = await seedDefaultLocation(db);
    const demo = options.demo
      ? await seedDemoCatalog(db, locationId)
      : { skipped: true, products: 0 };
    return { units, demo };
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]?.endsWith(join('seed', 'index.ts'));
if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const demo = process.env.SEED_DEMO !== 'false' && process.env.NODE_ENV !== 'production';
  seed(url, { demo })
    .then((result) => console.log('Seed complete:', JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
