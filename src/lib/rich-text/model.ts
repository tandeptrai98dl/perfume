/**
 * Tiptap JSON model and allowlist (ARCHITECTURE.md §12: rich text is sanitized with an
 * allowlist on render). Everything that renders rich text goes through `normalizeDoc`, which
 * keeps only the nodes, marks and attributes the editor can produce:
 *
 * - blocks: paragraph, heading (h2–h3), bulletList, orderedList, listItem, blockquote,
 *   horizontalRule, hardBreak
 * - marks: bold, italic, link (safe href only)
 *
 * Unknown nodes are unwrapped (their text is kept), unknown marks and attributes are dropped.
 */

export type RichTextMark = { type: string; attrs?: Record<string, unknown> };

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

export type RichTextDoc = { type: 'doc'; content?: RichTextNode[] };

export type SafeMark = { type: 'bold' } | { type: 'italic' } | { type: 'link'; href: string };

export type SafeNode =
  | { type: 'text'; text: string; marks: SafeMark[] }
  | { type: 'hardBreak' }
  | { type: 'horizontalRule' }
  | { type: 'paragraph'; content: SafeNode[] }
  | { type: 'heading'; level: 2 | 3; content: SafeNode[] }
  | { type: 'bulletList' | 'orderedList' | 'listItem' | 'blockquote'; content: SafeNode[] };

export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [] };

const MAX_DEPTH = 32;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Returns a safe href or null. Allows site-relative paths (`/x`, not `//host`), fragments and
 * http(s)/mailto/tel URLs. Control characters and whitespace are stripped before the scheme
 * check so `java\tscript:` cannot slip through.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const href = raw.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!href || href.length > 2048) return null;
  if (href.startsWith('#')) return href;
  if (href.startsWith('/')) return href.startsWith('//') || href.startsWith('/\\') ? null : href;
  try {
    const url = new URL(href);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Absolute http(s) link to another host (gets rel="noopener noreferrer" and a new tab). */
export function isExternalHref(href: string, siteOrigin?: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  if (!siteOrigin) return true;
  try {
    return new URL(href).host !== new URL(siteOrigin).host;
  } catch {
    return true;
  }
}

function normalizeMarks(marks: RichTextMark[] | undefined): SafeMark[] {
  const out: SafeMark[] = [];
  for (const mark of marks ?? []) {
    if (mark?.type === 'bold' && !out.some((m) => m.type === 'bold')) out.push({ type: 'bold' });
    else if (mark?.type === 'italic' && !out.some((m) => m.type === 'italic'))
      out.push({ type: 'italic' });
    else if (mark?.type === 'link' && !out.some((m) => m.type === 'link')) {
      const href = safeHref(mark.attrs?.href);
      if (href) out.push({ type: 'link', href });
    }
  }
  return out;
}

function normalizeChildren(nodes: unknown, depth: number): SafeNode[] {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return [];
  return nodes.flatMap((node) => normalizeNode(node as RichTextNode, depth + 1));
}

function normalizeNode(node: RichTextNode, depth: number): SafeNode[] {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return [];
  switch (node.type) {
    case 'text':
      return typeof node.text === 'string' && node.text !== ''
        ? [{ type: 'text', text: node.text, marks: normalizeMarks(node.marks) }]
        : [];
    case 'hardBreak':
      return [{ type: 'hardBreak' }];
    case 'horizontalRule':
      return [{ type: 'horizontalRule' }];
    case 'paragraph':
      return [{ type: 'paragraph', content: normalizeChildren(node.content, depth) }];
    case 'heading': {
      // h1 is reserved for the page title (§13.1); deeper levels collapse to h3.
      const level = Number(node.attrs?.level) <= 2 ? 2 : 3;
      return [{ type: 'heading', level, content: normalizeChildren(node.content, depth) }];
    }
    case 'bulletList':
    case 'orderedList':
    case 'listItem':
    case 'blockquote':
      return [{ type: node.type, content: normalizeChildren(node.content, depth) }];
    default:
      // Unknown wrapper (e.g. codeBlock, image, script): keep only its safe children.
      return normalizeChildren(node.content, depth);
  }
}

/** Parses untrusted JSON (or an already-parsed value) into the allowlisted tree. */
export function normalizeDoc(value: unknown): SafeNode[] {
  let doc = value;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return [];
    }
  }
  if (!doc || typeof doc !== 'object' || (doc as RichTextNode).type !== 'doc') return [];
  return normalizeChildren((doc as RichTextNode).content, 0);
}

/** True when the document has no visible text. */
export function isEmptyDoc(value: unknown): boolean {
  return richTextToPlainText(value).trim() === '';
}

function plainText(nodes: SafeNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text;
        case 'hardBreak':
          return '\n';
        case 'horizontalRule':
          return '\n';
        default:
          return `${plainText(node.content)}\n`;
      }
    })
    .join('');
}

/** Plain text for excerpts, meta descriptions and JSON-LD. Whitespace is collapsed. */
export function richTextToPlainText(value: unknown): string {
  return plainText(normalizeDoc(value)).replace(/\s+/g, ' ').trim();
}

export type FaqEntry = { question: string; answer: string };

/**
 * FAQ structure for FAQPage JSON-LD: every heading is a question and the blocks until the
 * next heading form its answer. Questions without an answer are skipped.
 */
export function extractFaq(value: unknown): FaqEntry[] {
  const entries: FaqEntry[] = [];
  let current: { question: string; parts: SafeNode[] } | null = null;
  const flush = () => {
    if (!current) return;
    const answer = plainText(current.parts).replace(/\s+/g, ' ').trim();
    if (current.question && answer) entries.push({ question: current.question, answer });
  };
  for (const node of normalizeDoc(value)) {
    if (node.type === 'heading') {
      flush();
      current = { question: plainText(node.content).replace(/\s+/g, ' ').trim(), parts: [] };
    } else if (current) {
      current.parts.push(node);
    }
  }
  flush();
  return entries;
}

/** Builds a minimal Tiptap doc from paragraphs/headings (seed data and tests). */
export function docFromBlocks(
  blocks: ({ h2: string } | { h3: string } | { p: string } | { ul: string[] })[],
): RichTextDoc {
  return {
    type: 'doc',
    content: blocks.map((block) => {
      if ('h2' in block || 'h3' in block) {
        const text = 'h2' in block ? block.h2 : block.h3;
        return {
          type: 'heading',
          attrs: { level: 'h2' in block ? 2 : 3 },
          content: [{ type: 'text', text }],
        };
      }
      if ('ul' in block) {
        return {
          type: 'bulletList',
          content: block.ul.map((item) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
          })),
        };
      }
      return { type: 'paragraph', content: block.p ? [{ type: 'text', text: block.p }] : [] };
    }),
  };
}
