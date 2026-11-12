/**
 * Cache tag contract between storefront reads ('use cache' + cacheTag) and writers
 * (admin saves call revalidateTag directly; the worker uses the `cache.revalidate` job).
 * Every catalogue read must tag with the entities it renders plus the matching list tag.
 */
export const catalogTags = {
  /** Any listing, filter facet, search index or sitemap that shows products. */
  productList: 'catalog:products',
  brandList: 'catalog:brands',
  categoryTree: 'catalog:categories',
  collectionList: 'catalog:collections',
  familyList: 'catalog:families',
  noteList: 'catalog:notes',
  /** Best-seller ranking (home rail, "best selling" sort); time-based, expire to refresh now. */
  bestSellers: 'catalog:best-sellers',
  product: (id: string) => `product:${id}`,
  brand: (id: string) => `brand:${id}`,
  category: (id: string) => `category:${id}`,
  collection: (id: string) => `collection:${id}`,
  family: (id: string) => `family:${id}`,
  /** Price and stock change often; product pages render them in dynamic islands instead. */
  inventory: (variantId: string) => `inventory:${variantId}`,
} as const;

export const contentTags = {
  banners: 'content:banners',
  menus: 'content:menus',
  redirects: 'content:redirects',
  pageList: 'content:pages',
  postList: 'content:posts',
  page: (id: string) => `page:${id}`,
  post: (id: string) => `post:${id}`,
} as const;
