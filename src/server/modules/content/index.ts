/**
 * Content module public API: journal posts and topics, static pages, banners, menus and
 * redirects (ARCHITECTURE.md §3.3). Shared with the worker: no `server-only`, no Next.js APIs
 * (ADR-0023). Cached storefront reads live in the Next-only layer `src/data/content.ts`.
 */

export * from './types';
export {
  getBannerForAdmin,
  getMenu,
  getMenuForAdmin,
  getPageForAdmin,
  getPostForAdmin,
  getPublishedPageByKey,
  getPublishedPolicyBySlug,
  getPublishedPost,
  getPublishedTopic,
  getSellerInfo,
  getTopicForAdmin,
  isBannerLive,
  listActiveBanners,
  listBannersForAdmin,
  listMediaOptions,
  listPagesForAdmin,
  listPostsForAdmin,
  listProductOptions,
  listPublishedPolicies,
  listPublishedPostSummaries,
  listPublishedTopics,
  listRedirectsForAdmin,
  listSitemapEntries,
  listTopicsForAdmin,
  loadRouteTableData,
  loadRouteTableVersion,
  resolveRedirect,
  type DbExecutor,
  type TranslationStatus,
} from './queries';
export {
  ContentError,
  createRedirect,
  createRedirectCommand,
  deleteBanner,
  deletePage,
  deletePost,
  deleteRedirect,
  deleteTopic,
  recordRedirectHits,
  saveBanner,
  saveMenu,
  savePage,
  savePost,
  saveTopic,
  type CommandResult,
  type ContentDeps,
  type ContentErrorCode,
} from './commands';
export { normalizePath, planRedirect, resolveFromTable } from './redirects';
export {
  buildSnapshot,
  createRouteTableCache,
  decideRoute,
  invalidateRouteTable,
  type RouteDecision,
  type RouteTableData,
  type RouteTableSnapshot,
} from './route-table';
export { CONTENT_ROUTES, journalPath, pagePath, postPath, topicPath } from './paths';
export type {
  BannerInput,
  MenuInput,
  PageInput,
  PostInput,
  RedirectInput,
  TopicInput,
} from './schemas';
