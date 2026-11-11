/**
 * Rich text (Tiptap JSON) helpers shared by the editor, server renderers and modules.
 * Renderers: `@/lib/rich-text/react` (storefront) and `@/lib/rich-text/html` (HTML strings,
 * server only because it pulls in sanitize-html).
 */
export * from './model';
