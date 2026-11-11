import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { RichTextDoc } from '@/server/modules/catalog';

/*
 * Renders Tiptap JSON (product descriptions, brand stories) as React elements. Only a fixed
 * set of nodes and marks is supported and no raw HTML is ever injected, so the output is safe
 * without a sanitizer. Unknown nodes render their children.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  type: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: Node[];
};

const SAFE_URL = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;

function renderMarks(text: string, marks: Mark[] | undefined): ReactNode {
  let node: ReactNode = text;
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') node = <strong>{node}</strong>;
    else if (mark.type === 'italic') node = <em>{node}</em>;
    else if (mark.type === 'underline') node = <u>{node}</u>;
    else if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      if (SAFE_URL.test(href)) {
        const external = /^https?:/i.test(href);
        node = (
          <a
            href={href}
            className="text-gold-700 underline underline-offset-4"
            {...(external ? { rel: 'noopener noreferrer nofollow', target: '_blank' } : {})}
          >
            {node}
          </a>
        );
      }
    }
  }
  return node;
}

function renderNodes(nodes: Node[] | undefined): ReactNode {
  return (nodes ?? []).map((node, index) => <Fragment key={index}>{renderNode(node)}</Fragment>);
}

function renderNode(node: Node): ReactNode {
  switch (node.type) {
    case 'text':
      return renderMarks(node.text ?? '', node.marks);
    case 'paragraph':
      return <p>{renderNodes(node.content)}</p>;
    case 'heading': {
      // Page titles own h1/h2; rich text starts at h3.
      const level = Number(node.attrs?.level ?? 3);
      return level <= 3 ? (
        <h3 className="text-h3">{renderNodes(node.content)}</h3>
      ) : (
        <h4 className="font-medium">{renderNodes(node.content)}</h4>
      );
    }
    case 'bulletList':
      return <ul className="list-disc pl-5">{renderNodes(node.content)}</ul>;
    case 'orderedList':
      return <ol className="list-decimal pl-5">{renderNodes(node.content)}</ol>;
    case 'listItem':
      return <li>{renderNodes(node.content)}</li>;
    case 'blockquote':
      return (
        <blockquote className="border-gold-500 border-l-2 pl-4 italic">
          {renderNodes(node.content)}
        </blockquote>
      );
    case 'hardBreak':
      return <br />;
    case 'horizontalRule':
      return <hr className="border-line-200" />;
    default:
      return renderNodes(node.content);
  }
}

export function RichText({ doc, className }: { doc: RichTextDoc; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {renderNodes((doc.content as Node[] | undefined) ?? [])}
    </div>
  );
}

/** True when the document has any text (an empty editor still produces a doc node). */
export function hasRichText(doc: RichTextDoc | null | undefined): doc is RichTextDoc {
  const visit = (node: Node): boolean =>
    (node.type === 'text' && Boolean(node.text?.trim())) || (node.content ?? []).some(visit);
  return Boolean(doc) && visit(doc as unknown as Node);
}
