/**
 * Plain text ⇄ rich-text document (Tiptap/ProseMirror JSON) for product descriptions until the
 * admin RichTextEditor replaces the textarea. Each blank-line-separated block becomes a
 * paragraph; single newlines become hard breaks.
 */

export type RichTextNode = {
  type: string;
  text?: string;
  content?: RichTextNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export type RichTextDoc = { type: 'doc'; content: RichTextNode[] };

export function plainTextToDoc(text: string): RichTextDoc | null {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return null;
  return {
    type: 'doc',
    content: blocks.map((block) => ({
      type: 'paragraph',
      content: block.split('\n').flatMap((line, index): RichTextNode[] => {
        const textNode: RichTextNode = { type: 'text', text: line };
        return index === 0 ? [textNode] : [{ type: 'hardBreak' }, textNode];
      }),
    })),
  };
}

function nodeText(node: RichTextNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(nodeText).join('');
}

export function docToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object' || (doc as RichTextNode).type !== 'doc') return '';
  return ((doc as RichTextDoc).content ?? [])
    .map(nodeText)
    .filter((block) => block.length > 0)
    .join('\n\n');
}
