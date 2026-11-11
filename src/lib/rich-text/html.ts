import sanitizeHtml from 'sanitize-html';

import { isExternalHref, normalizeDoc, safeHref, type SafeMark, type SafeNode } from './model';

/**
 * Tiptap JSON → HTML string for contexts that need markup (emails, feeds, legacy HTML).
 * Storefront pages use the React renderer (`./react`) instead. Output is built from the
 * allowlisted tree and then passed through sanitize-html as a second layer.
 */

export type RichTextRenderOptions = {
  /** Origin of the site (e.g. https://example.vn); links to other hosts are external. */
  siteOrigin?: string;
};

const ALLOWED_TAGS = [
  'p',
  'h2',
  'h3',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'br',
  'hr',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkAttrs(href: string, options: RichTextRenderOptions): string {
  const external = isExternalHref(href, options.siteOrigin);
  return external
    ? ` href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`
    : ` href="${escapeHtml(href)}"`;
}

function wrapMarks(text: string, marks: SafeMark[], options: RichTextRenderOptions): string {
  let html = escapeHtml(text);
  for (const mark of marks) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
  }
  const link = marks.find((m) => m.type === 'link');
  return link ? `<a${linkAttrs(link.href, options)}>${html}</a>` : html;
}

const BLOCK_TAGS = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'blockquote',
} as const;

function render(nodes: SafeNode[], options: RichTextRenderOptions): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return wrapMarks(node.text, node.marks, options);
        case 'hardBreak':
          return '<br>';
        case 'horizontalRule':
          return '<hr>';
        case 'heading':
          return `<h${node.level}>${render(node.content, options)}</h${node.level}>`;
        default: {
          const tag = BLOCK_TAGS[node.type];
          return `<${tag}>${render(node.content, options)}</${tag}>`;
        }
      }
    })
    .join('');
}

/**
 * Sanitizes arbitrary HTML with the rich-text allowlist. Links keep only safe hrefs; external
 * links open in a new tab with rel="noopener noreferrer".
 */
export function sanitizeRichHtml(html: string, options: RichTextRenderOptions = {}): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    // Drop the contents of dangerous elements entirely, not just the tags.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object'],
    transformTags: {
      h1: 'h2',
      h4: 'h3',
      h5: 'h3',
      h6: 'h3',
      b: 'strong',
      i: 'em',
      a: (_tagName, attribs): sanitizeHtml.Tag => {
        const href = safeHref(attribs.href);
        if (!href) return { tagName: 'span', attribs: {} };
        const safe: sanitizeHtml.Attributes = { href };
        if (isExternalHref(href, options.siteOrigin)) {
          safe.target = '_blank';
          safe.rel = 'noopener noreferrer';
        }
        return { tagName: 'a', attribs: safe };
      },
    },
  });
}

/** Renders stored Tiptap JSON to sanitized HTML. */
export function renderRichTextToHtml(value: unknown, options: RichTextRenderOptions = {}): string {
  return sanitizeRichHtml(render(normalizeDoc(value), options), options);
}
