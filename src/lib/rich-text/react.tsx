import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { isExternalHref, normalizeDoc, type SafeMark, type SafeNode } from './model';

/**
 * Tiptap JSON → React elements (no dangerouslySetInnerHTML). Only the allowlisted tree from
 * `normalizeDoc` is rendered, so stored content can never inject markup or scripts.
 */

export type RichTextProps = {
  /** Stored Tiptap JSON (`content jsonb`). */
  value: unknown;
  /** Site origin; links to other hosts open in a new tab with rel="noopener noreferrer". */
  siteOrigin?: string;
  className?: string;
};

function renderText(text: string, marks: SafeMark[], key: string, siteOrigin?: string) {
  let node: ReactNode = text;
  if (marks.some((m) => m.type === 'italic')) node = <em>{node}</em>;
  if (marks.some((m) => m.type === 'bold')) node = <strong>{node}</strong>;
  const link = marks.find((m) => m.type === 'link');
  if (link) {
    const external = isExternalHref(link.href, siteOrigin);
    node = (
      <a
        href={link.href}
        className="text-gold-700 hover:text-ink-950 underline underline-offset-4"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {node}
      </a>
    );
  }
  return <Fragment key={key}>{node}</Fragment>;
}

/**
 * Keys only need to be unique among siblings, so they are the sibling index. Never a dotted
 * tree path ("10.1.0.0"): keys are serialised into the RSC payload, where such paths read as
 * private IPv4 addresses to scanners (ZAP 2 "Private IP Disclosure" on long policy pages).
 */
function renderNodes(nodes: SafeNode[], siteOrigin: string | undefined): ReactNode[] {
  return nodes.map((node, index) => {
    const key = String(index);
    switch (node.type) {
      case 'text':
        return renderText(node.text, node.marks, key, siteOrigin);
      case 'hardBreak':
        return <br key={key} />;
      case 'horizontalRule':
        return <hr key={key} className="border-line-200 my-8" />;
      case 'heading': {
        const Tag = node.level === 2 ? 'h2' : 'h3';
        return (
          <Tag key={key} className={node.level === 2 ? 'text-h2 mt-10 mb-4' : 'text-h3 mt-8 mb-3'}>
            {renderNodes(node.content, siteOrigin)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="my-4">
            {renderNodes(node.content, siteOrigin)}
          </p>
        );
      case 'bulletList':
        return (
          <ul key={key} className="my-4 list-disc ps-6">
            {renderNodes(node.content, siteOrigin)}
          </ul>
        );
      case 'orderedList':
        return (
          <ol key={key} className="my-4 list-decimal ps-6">
            {renderNodes(node.content, siteOrigin)}
          </ol>
        );
      case 'listItem':
        return (
          <li key={key} className="my-1 [&>p]:my-0">
            {renderNodes(node.content, siteOrigin)}
          </li>
        );
      case 'blockquote':
        return (
          <blockquote
            key={key}
            className="border-gold-500 font-display text-body-lg my-6 border-s-2 ps-5 italic"
          >
            {renderNodes(node.content, siteOrigin)}
          </blockquote>
        );
    }
  });
}

/** Renders rich text with the storefront's typographic rhythm. */
export function RichText({ value, siteOrigin, className }: RichTextProps) {
  return (
    <div className={cn('text-body text-ink-700 max-w-prose', className)}>
      {renderNodes(normalizeDoc(value), siteOrigin)}
    </div>
  );
}
