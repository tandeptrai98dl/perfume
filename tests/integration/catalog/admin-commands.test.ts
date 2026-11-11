import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { plainTextToDoc } from '@/lib/plain-text-doc';
import { createRedirect } from '@/server/modules/content';
import {
  auditLogs,
  brandTranslations,
  inventoryItems,
  media,
  productMedia,
  productNotes,
  products,
  productTranslations,
  productVariants,
  redirects,
} from '@/server/db/schema';
import { createMemoryStorage } from '@/server/integrations/storage';
import { DomainError } from '@/server/lib/command-context';
import {
  adminSchemas,
  createProduct,
  deleteBrand,
  deleteNote,
  duplicateProduct,
  getProductForEdit,
  listBrands,
  listCategories,
  listProducts,
  saveBrand,
  saveCategory,
  saveCollection,
  saveNote,
  saveProduct,
  saveProductLine,
  setCollectionProducts,
  setProductStatus,
  uploadMedia,
  type ProductSaveInput,
  type SlugChange,
} from '@/server/modules/catalog';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

let h: CommandHarness;

beforeAll(async () => {
  h = await startCommandHarness();
});

afterAll(async () => {
  await h?.stop();
});

async function expectDomainError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

function brandInput(name: string, slug: string, en?: { slug: string; isPublished: boolean }) {
  return adminSchemas.brandInputSchema.parse({
    name,
    country: 'fr',
    status: 'active',
    translations: {
      vi: { slug, isPublished: true, story: plainTextToDoc('Câu chuyện thương hiệu') },
      en: en ?? null,
    },
  });
}

async function auditRows(action: string) {
  return h.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

/** Builds a full editor payload from what getProductForEdit returns. */
async function editorPayload(id: string): Promise<ProductSaveInput> {
  const data = (await getProductForEdit(h.db, id))!;
  const { product } = data;
  return adminSchemas.productSaveSchema.parse({
    id,
    expectedUpdatedAt: product.updatedAt.toISOString(),
    details: {
      brandId: product.brandId,
      productLineId: product.productLineId,
      gender: product.gender,
      concentration: product.concentration,
      releaseYear: product.releaseYear,
      perfumer: product.perfumer,
      longevity: product.longevity,
      sillage: product.sillage,
      seasons: product.seasons,
      occasions: product.occasions,
      isFeatured: product.isFeatured,
      categoryIds: data.categoryIds,
    },
    translations: {
      vi: data.translations.vi,
      en: data.translations.en,
    },
    variants: data.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      sizeMl: v.sizeMl,
      variantType: v.variantType,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      weightG: v.weightG,
      isDefault: v.isDefault,
      isActive: v.isActive,
    })),
    scent: { notes: data.notes, families: data.families },
    media: data.media.map((m) => ({
      mediaId: m.id,
      variantIndex: null,
      alt: { vi: m.alt.vi ?? 'ảnh', en: m.alt.en },
    })),
    compliance: {
      countryOfOrigin: product.countryOfOrigin,
      cosmeticNotificationNo: product.cosmeticNotificationNo,
      responsibleImporter: product.responsibleImporter,
      ingredients: product.ingredients,
      warnings: product.warnings,
    },
  });
}

describe('brands', () => {
  it('creates a brand with translations, an audit row and an outbox job in one transaction', async () => {
    const jobsBefore = (await h.jobs('cache.revalidate')).length;
    const result = await saveBrand(
      h.ctx('owner'),
      null,
      brandInput('Maison Test', 'maison-test', { slug: 'maison-test', isPublished: false }),
    );
    expect(result.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(result.tags).toEqual(
      expect.arrayContaining([`brand:${result.data.id}`, 'catalog:brands', 'catalog:products']),
    );

    const translations = await h.db
      .select()
      .from(brandTranslations)
      .where(eq(brandTranslations.brandId, result.data.id));
    expect(translations.map((t) => [t.locale, t.slug, t.isPublished]).sort()).toEqual([
      ['en', 'maison-test', false],
      ['vi', 'maison-test', true],
    ]);

    const [audit] = (await auditRows('brand.create')).filter((r) => r.entityId === result.data.id);
    expect(audit?.actorId).toBe(h.actorIds.owner);
    expect(audit?.diff).toMatchObject({ name: { from: null, to: 'Maison Test' } });

    const jobs = await h.jobs('cache.revalidate');
    expect(jobs.length).toBe(jobsBefore + 1);
    expect(jobs.at(-1)?.data.tags).toEqual(result.tags);

    const list = await listBrands(h.db, adminSchemas.listQuerySchema.parse({ q: 'maison test' }));
    expect(list.rows.find((r) => r.id === result.data.id)).toMatchObject({
      viStatus: 'published',
      enStatus: 'draft',
    });
  });

  it('rejects a slug already used in the same locale', async () => {
    const error = await expectDomainError(
      saveBrand(h.ctx('owner'), null, brandInput('Other', 'maison-test')),
      'slugTaken',
    );
    expect(error.fieldErrors).toEqual([{ path: 'translations.vi.slug', code: 'slugTaken' }]);
  });

  it('rolls back everything when a command fails after writing', async () => {
    const before = (await h.jobs('cache.revalidate')).length;
    const auditsBefore = (await auditRows('brand.create')).length;
    await expect(
      saveBrand(
        {
          ...h.ctx('owner'),
          // A failing hook inside the transaction must undo the brand, audit and job.
          boss: { send: async () => Promise.reject(new Error('queue down')) } as never,
        },
        null,
        brandInput('Rollback', 'rollback-brand'),
      ),
    ).rejects.toThrow('queue down');
    expect((await h.jobs('cache.revalidate')).length).toBe(before);
    expect((await auditRows('brand.create')).length).toBe(auditsBefore);
    const rows = await h.db
      .select()
      .from(brandTranslations)
      .where(eq(brandTranslations.slug, 'rollback-brand'));
    expect(rows).toHaveLength(0);
  });

  it('reports slug changes of published translations and calls the redirect hook', async () => {
    const created = await saveBrand(
      h.ctx('owner'),
      null,
      brandInput('Slug Brand', 'slug-brand', { slug: 'slug-brand-en', isPublished: true }),
    );
    const seen: SlugChange[] = [];
    const updated = await saveBrand(
      {
        ...h.ctx('owner'),
        onSlugChanges: async (tx, changes) => {
          // Runs inside the transaction: the new slug is already visible.
          const rows = await tx
            .select()
            .from(brandTranslations)
            .where(eq(brandTranslations.brandId, created.data.id));
          expect(rows.find((r) => r.locale === 'vi')?.slug).toBe('slug-brand-moi');
          seen.push(...changes);
        },
      },
      created.data.id,
      brandInput('Slug Brand', 'slug-brand-moi', { slug: 'slug-brand-en', isPublished: true }),
    );
    expect(updated.data.slugChanges).toEqual([
      {
        entityType: 'brand',
        entityId: created.data.id,
        locale: 'vi',
        fromSlug: 'slug-brand',
        toSlug: 'slug-brand-moi',
        fromPath: '/thuong-hieu/slug-brand',
        toPath: '/thuong-hieu/slug-brand-moi',
      },
    ]);
    expect(seen).toEqual(updated.data.slugChanges);
  });

  it('writes a 301 for a changed slug through the content module (as the admin action does)', async () => {
    const created = await saveBrand(
      h.ctx('owner'),
      null,
      brandInput('Redirect Brand', 'redirect-brand'),
    );
    await saveBrand(
      {
        ...h.ctx('owner'),
        onSlugChanges: async (tx, changes) => {
          for (const change of changes) {
            await createRedirect(tx, {
              fromPath: change.fromPath,
              toPath: change.toPath,
              statusCode: 301,
            });
          }
        },
      },
      created.data.id,
      brandInput('Redirect Brand', 'redirect-brand-moi'),
    );
    const rows = await h.db
      .select({ toPath: redirects.toPath, statusCode: redirects.statusCode })
      .from(redirects)
      .where(eq(redirects.fromPath, '/thuong-hieu/redirect-brand'));
    expect(rows).toEqual([{ toPath: '/thuong-hieu/redirect-brand-moi', statusCode: 301 }]);
  });

  it('forbids staff, who lack products.editContent', async () => {
    await expectDomainError(
      saveBrand(h.ctx('staff'), null, brandInput('Nope', 'nope')),
      'forbidden',
    );
  });
});

describe('categories and taxonomy', () => {
  it('keeps the category tree at two levels', async () => {
    const root = await saveCategory(
      h.ctx('editor'),
      null,
      adminSchemas.categoryInputSchema.parse({
        translations: { vi: { name: 'Nam', slug: 'nam', isPublished: true }, en: null },
      }),
    );
    const child = await saveCategory(
      h.ctx('editor'),
      null,
      adminSchemas.categoryInputSchema.parse({
        parentId: root.data.id,
        translations: { vi: { name: 'Nam trẻ', slug: 'nam-tre', isPublished: true }, en: null },
      }),
    );
    const error = await expectDomainError(
      saveCategory(
        h.ctx('editor'),
        null,
        adminSchemas.categoryInputSchema.parse({
          parentId: child.data.id,
          translations: { vi: { name: 'Cấp 3', slug: 'cap-3' }, en: null },
        }),
      ),
      'invalid',
    );
    expect(error.fieldErrors).toEqual([{ path: 'parentId', code: 'tooDeep' }]);
    const tree = await listCategories(h.db);
    const rootIndex = tree.findIndex((c) => c.id === root.data.id);
    expect(tree[rootIndex + 1]?.id).toBe(child.data.id);
  });

  it('refuses to delete a note used by a product', async () => {
    const note = await saveNote(
      h.ctx('editor'),
      null,
      adminSchemas.taxonomyInputSchema.parse({
        translations: {
          vi: { name: 'Xạ hương', slug: 'xa-huong' },
          en: { name: 'Musk', slug: 'musk' },
        },
      }),
    );
    const brand = await saveBrand(h.ctx('owner'), null, brandInput('Note Brand', 'note-brand'));
    const product = await createProduct(
      h.ctx('owner'),
      adminSchemas.productCreateSchema.parse({
        brandId: brand.data.id,
        gender: 'unisex',
        concentration: 'edp',
        translations: { vi: { name: 'Xạ', slug: 'xa' } },
      }),
    );
    await h.db
      .insert(productNotes)
      .values({ productId: product.data.id, noteId: note.data.id, layer: 'base' });
    await expectDomainError(deleteNote(h.ctx('editor'), note.data.id), 'inUse');
    await expectDomainError(deleteBrand(h.ctx('owner'), brand.data.id), 'inUse');
  });
});

describe('products', () => {
  let brandId: string;
  let productId: string;

  beforeAll(async () => {
    brandId = (await saveBrand(h.ctx('owner'), null, brandInput('Product Brand', 'product-brand')))
      .data.id;
    await saveProductLine(h.ctx('owner'), null, { brandId, name: 'Line A' });
    productId = (
      await createProduct(
        h.ctx('owner'),
        adminSchemas.productCreateSchema.parse({
          brandId,
          gender: 'male',
          concentration: 'edt',
          translations: { vi: { name: 'Gỗ Đêm EDT', slug: 'go-dem-edt' } },
        }),
      )
    ).data.id;
  });

  it('saves the full editor with variants, inventory rows, scent and English content', async () => {
    const note = await saveNote(
      h.ctx('owner'),
      null,
      adminSchemas.taxonomyInputSchema.parse({
        translations: { vi: { name: 'Tuyết tùng', slug: 'tuyet-tung' }, en: null },
      }),
    );
    const payload = await editorPayload(productId);
    payload.translations.en = adminSchemas.productTranslationSchema.parse({
      name: 'Night Wood EDT',
      slug: 'night-wood-edt',
      seoTitle: 'Night Wood EDT',
      isPublished: true,
    });
    payload.variants = [
      adminSchemas.variantInputSchema.parse({
        sku: 'pb-gd-100',
        sizeMl: 100,
        variantType: 'full_size',
        price: 3_200_000,
        compareAtPrice: 3_500_000,
        weightG: 450,
        isDefault: true,
      }),
    ];
    payload.scent.notes.base = [note.data.id];
    payload.compliance.countryOfOrigin = 'Pháp';

    const result = await saveProduct(h.ctx('owner'), payload);
    expect(result.tags).toEqual(
      expect.arrayContaining([`product:${productId}`, 'catalog:products', `brand:${brandId}`]),
    );
    const data = (await getProductForEdit(h.db, productId))!;
    expect(data.variants).toHaveLength(1);
    expect(data.variants[0]).toMatchObject({ sku: 'PB-GD-100', price: 3_200_000, onHand: 0 });
    expect(data.translations.en).toMatchObject({ slug: 'night-wood-edt', isPublished: true });
    expect(data.notes.base).toEqual([note.data.id]);
    expect(data.product.countryOfOrigin).toBe('Pháp');
    const inventory = await h.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.variantId, data.variants[0]!.id));
    expect(inventory).toHaveLength(1);

    const [audit] = (await auditRows('product.update')).filter((r) => r.entityId === productId);
    expect(audit?.diff).toMatchObject({
      'translations.en.slug': { from: null, to: 'night-wood-edt' },
      'variants.PB-GD-100.price': { from: null, to: 3_200_000 },
      countryOfOrigin: { from: null, to: 'Pháp' },
    });

    const list = await listProducts(h.db, adminSchemas.listQuerySchema.parse({ q: 'PB-GD' }));
    expect(list.rows.map((r) => r.id)).toEqual([productId]);
    expect(list.rows[0]).toMatchObject({ minPrice: 3_200_000, enStatus: 'published' });
  });

  it('rejects a stale editor (optimistic lock)', async () => {
    const payload = await editorPayload(productId);
    await saveProduct(h.ctx('owner'), payload);
    await expectDomainError(saveProduct(h.ctx('owner'), payload), 'conflict');
  });

  it('lets an editor change content but not prices', async () => {
    const payload = await editorPayload(productId);
    payload.translations.vi.subtitle = 'Gỗ tuyết tùng';
    const ok = await saveProduct(h.ctx('editor'), payload);
    expect(ok.data.id).toBe(productId);

    const priced = await editorPayload(productId);
    priced.variants[0]!.price = 1;
    const error = await expectDomainError(saveProduct(h.ctx('editor'), priced), 'forbiddenField');
    expect(error.fieldErrors).toEqual([{ path: 'variants.0.price', code: 'forbiddenField' }]);

    const added = await editorPayload(productId);
    added.variants.push(
      adminSchemas.variantInputSchema.parse({
        sku: 'PB-GD-10',
        sizeMl: 10,
        variantType: 'travel',
        price: 0,
        weightG: 50,
      }),
    );
    await expectDomainError(saveProduct(h.ctx('editor'), added), 'forbiddenField');

    const [variant] = await h.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    expect(variant?.price).toBe(3_200_000);
  });

  it('never accepts decant variants from the admin (ADR-0015)', () => {
    const parsed = adminSchemas.variantInputSchema.safeParse({
      sku: 'X-1',
      sizeMl: 5,
      variantType: 'decant',
      price: 100_000,
      weightG: 10,
    });
    expect(parsed.success).toBe(false);
  });

  it('requires every saved variant to stay in the payload', async () => {
    const payload = await editorPayload(productId);
    payload.variants = [];
    const error = await expectDomainError(saveProduct(h.ctx('owner'), payload), 'invalid');
    expect(error.fieldErrors).toEqual([{ path: 'variants', code: 'variantsMissing' }]);
  });

  it('publishes only with an active variant and keeps publishedAt', async () => {
    const empty = await createProduct(
      h.ctx('owner'),
      adminSchemas.productCreateSchema.parse({
        brandId,
        gender: 'female',
        concentration: 'edp',
        translations: { vi: { name: 'Không biến thể', slug: 'khong-bien-the' } },
      }),
    );
    await expectDomainError(
      setProductStatus(h.ctx('owner'), { id: empty.data.id, status: 'active' }),
      'invalid',
    );
    await setProductStatus(h.ctx('editor'), { id: productId, status: 'active' });
    const [row] = await h.db.select().from(products).where(eq(products.id, productId));
    expect(row?.status).toBe('active');
    expect(row?.publishedAt).toBeInstanceOf(Date);
  });

  it('reports a changed slug of a published product', async () => {
    const payload = await editorPayload(productId);
    payload.translations.en!.slug = 'night-wood-eau-de-toilette';
    const result = await saveProduct(h.ctx('owner'), payload);
    expect(result.data.slugChanges).toEqual([
      expect.objectContaining({
        locale: 'en',
        fromPath: '/en/products/night-wood-edt',
        toPath: '/en/products/night-wood-eau-de-toilette',
      }),
    ]);
  });

  it('duplicates as an unpublished draft with new slugs and SKUs', async () => {
    const copy = await duplicateProduct(h.ctx('editor'), { id: productId });
    const [row] = await h.db.select().from(products).where(eq(products.id, copy.data.id));
    expect(row).toMatchObject({ status: 'draft', publishedAt: null });
    const translations = await h.db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, copy.data.id));
    expect(translations.map((t) => [t.locale, t.slug, t.isPublished]).sort()).toEqual([
      ['en', 'night-wood-eau-de-toilette-copy', false],
      ['vi', 'go-dem-edt-copy', false],
    ]);
    const variants = await h.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, copy.data.id));
    expect(variants.map((v) => [v.sku, v.isActive, v.price])).toEqual([
      ['PB-GD-100-COPY', false, 3_200_000],
    ]);
    const second = await duplicateProduct(h.ctx('editor'), { id: productId });
    const secondSlugs = await h.db
      .select({ slug: productTranslations.slug })
      .from(productTranslations)
      .where(
        and(
          eq(productTranslations.productId, second.data.id),
          eq(productTranslations.locale, 'vi'),
        ),
      );
    expect(secondSlugs[0]?.slug).toBe('go-dem-edt-copy-2');
  });

  it('stores uploaded media and links it with alt text per locale', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({
      create: { width: 640, height: 800, channels: 3, background: '#c8b496' },
    })
      .jpeg()
      .toBuffer();
    const storage = createMemoryStorage();
    const uploaded = await uploadMedia(
      { ...h.ctx('editor'), storage },
      { buffer: jpeg, fileName: 'Gỗ Đêm.jpg', altVi: 'Chai Gỗ Đêm' },
    );
    expect(uploaded).toMatchObject({ width: 640, height: 800, mime: 'image/webp' });
    expect(storage.objects.has(uploaded.storageKey)).toBe(true);

    await expectDomainError(
      uploadMedia({ ...h.ctx('staff'), storage }, { buffer: jpeg, fileName: 'x.jpg' }),
      'forbidden',
    );
    const bad = await expectDomainError(
      uploadMedia(
        { ...h.ctx('editor'), storage },
        { buffer: Buffer.from('nope'), fileName: 'x.jpg' },
      ),
      'invalid',
    );
    expect(bad.fieldErrors).toEqual([{ path: 'file', code: 'unsupportedType' }]);

    const payload = await editorPayload(productId);
    payload.media = [
      {
        mediaId: uploaded.id,
        variantIndex: 0,
        alt: { vi: 'Chai Gỗ Đêm 100ml', en: 'Night Wood bottle' },
      },
    ];
    await saveProduct(h.ctx('editor'), payload);
    const data = (await getProductForEdit(h.db, productId))!;
    expect(data.media).toHaveLength(1);
    expect(data.media[0]).toMatchObject({
      id: uploaded.id,
      variantId: data.variants[0]!.id,
      alt: { vi: 'Chai Gỗ Đêm 100ml', en: 'Night Wood bottle' },
    });
    const [link] = await h.db
      .select()
      .from(productMedia)
      .where(eq(productMedia.mediaId, uploaded.id));
    expect(link?.productId).toBe(productId);
    const [row] = await h.db.select().from(media).where(eq(media.id, uploaded.id));
    expect(row?.blurDataUrl).toMatch(/^data:image\/webp/);
  });

  it('orders collection products manually', async () => {
    const collection = await saveCollection(
      h.ctx('editor'),
      null,
      adminSchemas.collectionInputSchema.parse({
        translations: { vi: { name: 'Quà tặng', slug: 'qua-tang', isPublished: true }, en: null },
      }),
    );
    const other = await createProduct(
      h.ctx('owner'),
      adminSchemas.productCreateSchema.parse({
        brandId,
        gender: 'unisex',
        concentration: 'parfum',
        translations: { vi: { name: 'Thứ hai', slug: 'thu-hai' } },
      }),
    );
    await setCollectionProducts(h.ctx('editor'), {
      collectionId: collection.data.id,
      productIds: [other.data.id, productId],
    });
    const rows = await h.db.execute<{ product_id: string; position: number }>(
      sql`select product_id, position from collection_products where collection_id = ${collection.data.id} order by position`,
    );
    expect(rows.rows.map((r) => r.product_id)).toEqual([other.data.id, productId]);
  });
});
