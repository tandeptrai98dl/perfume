import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderRichTextToHtml, sanitizeRichHtml } from './html';
import {
  docFromBlocks,
  extractFaq,
  isEmptyDoc,
  normalizeDoc,
  richTextToPlainText,
  safeHref,
  splitByHeadings,
} from './model';
import { RichText } from './react';

const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('safeHref', () => {
  it.each([
    ['/nuoc-hoa', '/nuoc-hoa'],
    ['#section', '#section'],
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['mailto:hello@example.com', 'mailto:hello@example.com'],
    ['tel:+84901234567', 'tel:+84901234567'],
  ])('allows %s', (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    '\u0000javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//evil.example.com',
    '/\\evil.example.com',
    '',
    42,
  ])('rejects %s', (input) => {
    expect(safeHref(input)).toBeNull();
  });
});

describe('normalizeDoc', () => {
  it('keeps allowlisted nodes and marks', () => {
    const nodes = normalizeDoc(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        p(
          text('bold', [{ type: 'bold' }]),
          text('link', [{ type: 'link', attrs: { href: '/a' } }]),
        ),
      ),
    );
    expect(nodes).toEqual([
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Title', marks: [] }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'link', marks: [{ type: 'link', href: '/a' }] },
        ],
      },
    ]);
  });

  it('unwraps unknown nodes, drops unknown marks and unsafe links', () => {
    const nodes = normalizeDoc(
      doc({
        type: 'codeBlock',
        content: [
          text('x', [{ type: 'code' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        ],
      }),
    );
    expect(nodes).toEqual([{ type: 'text', text: 'x', marks: [] }]);
  });

  it('maps h1 to h2 and h4+ to h3', () => {
    const nodes = normalizeDoc(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('a')] },
        { type: 'heading', attrs: { level: 5 }, content: [text('b')] },
      ),
    );
    expect(nodes.map((n) => (n.type === 'heading' ? n.level : null))).toEqual([2, 3]);
  });

  it('rejects non-documents and invalid JSON', () => {
    expect(normalizeDoc(null)).toEqual([]);
    expect(normalizeDoc('{not json')).toEqual([]);
    expect(normalizeDoc({ type: 'paragraph' })).toEqual([]);
    expect(normalizeDoc(JSON.stringify(doc(p(text('ok')))))).toHaveLength(1);
  });

  it('bounds nesting depth', () => {
    let node: Record<string, unknown> = text('deep');
    for (let i = 0; i < 200; i += 1) node = { type: 'blockquote', content: [node] };
    expect(() => normalizeDoc(doc(node))).not.toThrow();
  });
});

describe('renderRichTextToHtml', () => {
  it('renders the allowlisted tree', () => {
    const html = renderRichTextToHtml(
      doc(
        { type: 'heading', attrs: { level: 3 }, content: [text('Notes')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('Rose'))] }] },
        { type: 'blockquote', content: [p(text('Quote', [{ type: 'italic' }]))] },
      ),
    );
    expect(html).toBe(
      '<h3>Notes</h3><ul><li><p>Rose</p></li></ul><blockquote><p><em>Quote</em></p></blockquote>',
    );
  });

  it('escapes text so stored content cannot inject markup', () => {
    const html = renderRichTextToHtml(
      doc(p(text('<script>alert(1)</script><img src=x onerror=alert(1)>'))),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('adds rel="noopener noreferrer" to external links only', () => {
    const html = renderRichTextToHtml(
      doc(
        p(
          text('out', [{ type: 'link', attrs: { href: 'https://brand.example.com' } }]),
          text('in', [{ type: 'link', attrs: { href: 'https://shop.example.vn/x' } }]),
          text('rel', [{ type: 'link', attrs: { href: '/journal' } }]),
        ),
      ),
      { siteOrigin: 'https://shop.example.vn' },
    );
    expect(html).toContain(
      '<a href="https://brand.example.com/" target="_blank" rel="noopener noreferrer">out</a>',
    );
    expect(html).toContain('<a href="https://shop.example.vn/x">in</a>');
    expect(html).toContain('<a href="/journal">rel</a>');
  });

  it('drops attribute injection through link hrefs', () => {
    const html = renderRichTextToHtml(
      doc(p(text('x', [{ type: 'link', attrs: { href: '/a" onmouseover="alert(1)' } }]))),
    );
    expect(html).not.toMatch(/onmouseover="/);
  });
});

describe('sanitizeRichHtml', () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<p onclick="alert(1)">x</p>', '<p>x</p>'],
    ['<a href="javascript:alert(1)">x</a>', 'x'],
    ['<a href="//evil.example.com">x</a>', 'x'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<iframe src="https://evil.example.com"></iframe>', ''],
    ['<svg><script>alert(1)</script></svg>', ''],
    ['<h1>T</h1><b>b</b><i>i</i>', '<h2>T</h2><strong>b</strong><em>i</em>'],
    ['<style>p{}</style><p style="color:red">x</p>', '<p>x</p>'],
  ])('sanitizes %s', (input, expected) => {
    expect(sanitizeRichHtml(input)).toBe(expected);
  });

  it('forces rel on external links even when the input sets its own', () => {
    expect(sanitizeRichHtml('<a href="https://x.example.com" rel="opener">x</a>')).toBe(
      '<a href="https://x.example.com/" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });
});

describe('React renderer', () => {
  it('renders without dangerouslySetInnerHTML and with safe links', () => {
    const markup = renderToStaticMarkup(
      RichText({
        value: doc(
          p(text('<b>x</b>')),
          p(text('out', [{ type: 'link', attrs: { href: 'https://brand.example.com' } }])),
          p(text('bad', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
        ),
      }),
    );
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
    expect(markup).not.toContain('javascript:');
  });
});

describe('text helpers', () => {
  const faq = docFromBlocks([
    { p: 'Intro' },
    { h2: 'Is every bottle authentic?' },
    { p: 'Yes.' },
    { p: 'Always.' },
    { h3: 'Empty question' },
    { h2: 'How long is delivery?' },
    { ul: ['1–2 days', '3–5 days'] },
  ]);

  it('extracts FAQ entries from headings', () => {
    expect(extractFaq(faq)).toEqual([
      { question: 'Is every bottle authentic?', answer: 'Yes. Always.' },
      { question: 'How long is delivery?', answer: '1–2 days 3–5 days' },
    ]);
  });

  it('builds plain text and detects empty docs', () => {
    expect(richTextToPlainText(docFromBlocks([{ h2: 'A' }, { p: 'B  C' }]))).toBe('A B C');
    expect(isEmptyDoc(docFromBlocks([{ p: '' }]))).toBe(true);
    expect(isEmptyDoc(faq)).toBe(false);
  });

  it('splits a document at its headings', () => {
    const { intro, sections } = splitByHeadings(faq);
    expect(richTextToPlainText(intro)).toBe('Intro');
    expect(sections.map((s) => [s.heading, richTextToPlainText(s.body)])).toEqual([
      ['Is every bottle authentic?', 'Yes. Always.'],
      ['Empty question', ''],
      ['How long is delivery?', '1–2 days 3–5 days'],
    ]);
  });
});

describe('RichText React keys', () => {
  /** ZAP passive rule 2 (Private IP Disclosure), IPv4 part. */
  const PRIVATE_IP =
    /(?<!\d\.)\b(10\.(\d{1,3}\.){2}\d{1,3}|172\.(3[01]|2\d|1[6-9])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b(?!\.\d)/;

  function collectKeys(node: unknown, keys: string[] = []): string[] {
    if (Array.isArray(node)) {
      for (const child of node) collectKeys(child, keys);
    } else if (node && typeof node === 'object' && 'props' in node) {
      const element = node as { key: string | null; props: { children?: unknown } };
      if (element.key !== null) keys.push(element.key);
      collectKeys(element.props.children, keys);
    }
    return keys;
  }

  it('uses sibling indexes, never dotted tree paths that look like private IPs', () => {
    // The privacy policy has more than ten blocks with nested lists: index 10 → "10.1.0.0".
    const blocks = Array.from({ length: 12 }, (_, i) =>
      i === 10 ? { ul: ['first item', 'second item', 'third item'] } : { p: `Paragraph ${i + 1}` },
    );
    const element = RichText({ value: docFromBlocks(blocks) });
    const keys = collectKeys(element);
    expect(keys.length).toBeGreaterThan(12);
    for (const key of keys) {
      expect(key).toMatch(/^\d+$/);
      expect(key).not.toMatch(PRIVATE_IP);
    }
    expect(renderToStaticMarkup(element)).toContain('<li class="my-1 [&amp;&gt;p]:my-0">');
  });
});
