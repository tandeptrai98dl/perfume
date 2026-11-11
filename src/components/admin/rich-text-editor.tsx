'use client';

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMPTY_DOC, safeHref, type RichTextDoc } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

/**
 * Tiptap editor limited to what the storefront renders (§12 allowlist): h2–h3, bold, italic,
 * bullet/ordered lists, blockquote and safe links. Generic props so any admin form can use it
 * (content, product descriptions):
 *
 *   <RichTextEditor id="desc" value={doc} onChange={setDoc} aria-labelledby="desc-label" />
 *
 * The toolbar is a WAI-ARIA toolbar (one tab stop, arrow keys move between buttons).
 */
export type RichTextEditorProps = {
  value: RichTextDoc | null | undefined;
  onChange: (value: RichTextDoc) => void;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  className?: string;
};

type ToolbarAction = {
  key: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
  active?: (editor: Editor) => boolean;
  enabled?: (editor: Editor) => boolean;
};

const ACTIONS: ToolbarAction[] = [
  {
    key: 'heading2',
    icon: Heading2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    key: 'heading3',
    icon: Heading3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    key: 'bold',
    icon: Bold,
    run: (e) => e.chain().focus().toggleBold().run(),
    active: (e) => e.isActive('bold'),
  },
  {
    key: 'italic',
    icon: Italic,
    run: (e) => e.chain().focus().toggleItalic().run(),
    active: (e) => e.isActive('italic'),
  },
  {
    key: 'bulletList',
    icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  {
    key: 'orderedList',
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  {
    key: 'blockquote',
    icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    active: (e) => e.isActive('blockquote'),
  },
  { key: 'link', icon: Link2, run: () => {}, active: (e) => e.isActive('link') },
  {
    key: 'unlink',
    icon: Link2Off,
    run: (e) => e.chain().focus().extendMarkRange('link').unsetLink().run(),
    enabled: (e) => e.isActive('link'),
  },
  {
    key: 'undo',
    icon: Undo2,
    run: (e) => e.chain().focus().undo().run(),
    enabled: (e) => e.can().undo(),
  },
  {
    key: 'redo',
    icon: Redo2,
    run: (e) => e.chain().focus().redo().run(),
    enabled: (e) => e.can().redo(),
  },
];

export function RichTextEditor({
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled = false,
  className,
}: RichTextEditorProps) {
  const t = useTranslations('admin.richText');
  const linkInputId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const lastEmitted = useRef<string>(JSON.stringify(value ?? EMPTY_DOC));

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          isAllowedUri: (url) => safeHref(url) !== null,
          HTMLAttributes: { rel: 'noopener noreferrer', target: null },
        },
      }),
    ],
    content: value ?? EMPTY_DOC,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
        ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
        ...(ariaInvalid ? { 'aria-invalid': 'true' } : {}),
        class: cn(
          'min-h-48 px-4 py-3 text-body text-ink-950 outline-none',
          '[&_h2]:text-h2 [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-h3 [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-2',
          '[&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6',
          '[&_blockquote]:border-gold-500 [&_blockquote]:border-s-2 [&_blockquote]:ps-4 [&_blockquote]:italic',
          '[&_a]:text-gold-700 [&_a]:underline',
        ),
      },
    },
    onUpdate: ({ editor: current }) => {
      const json = current.getJSON() as RichTextDoc;
      lastEmitted.current = JSON.stringify(json);
      onChange(json);
    },
  });

  // Keep the editor in sync when the form resets or loads another document.
  useEffect(() => {
    if (!editor) return;
    const next = JSON.stringify(value ?? EMPTY_DOC);
    if (next !== lastEmitted.current) {
      lastEmitted.current = next;
      editor.commands.setContent(value ?? EMPTY_DOC, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? ACTIONS.map((action) => ({
            active: action.active?.(current) ?? false,
            enabled: action.enabled?.(current) ?? true,
          }))
        : null,
  });

  function openLink() {
    if (!editor) return;
    setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkError(false);
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = safeHref(linkValue.trim());
    if (!href) {
      setLinkError(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  }

  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = ACTIONS.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: focusIndex === last ? 0 : focusIndex + 1,
      ArrowLeft: focusIndex === 0 ? last : focusIndex - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setFocusIndex(next);
    buttons.current[next]?.focus();
  }

  return (
    <div
      className={cn(
        'rounded-input border-line-200 focus-within:border-ink-950 border bg-white',
        ariaInvalid && 'border-danger',
        disabled && 'bg-sand-100 opacity-70',
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label={t('toolbar')}
        aria-controls={id}
        onKeyDown={onToolbarKeyDown}
        className="border-line-200 flex flex-wrap gap-1 border-b p-1"
      >
        {ACTIONS.map((action, index) => {
          const Icon = action.icon;
          const status = state?.[index];
          const toggles = Boolean(action.active);
          return (
            <button
              key={action.key}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              tabIndex={index === focusIndex ? 0 : -1}
              aria-label={t(action.key as 'bold')}
              title={t(action.key as 'bold')}
              aria-pressed={toggles ? Boolean(status?.active) : undefined}
              disabled={disabled || !editor || status?.enabled === false}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                if (!editor) return;
                if (action.key === 'link') openLink();
                else action.run(editor);
              }}
              className={cn(
                'text-ink-950 hover:bg-sand-100 inline-flex size-9 items-center justify-center disabled:opacity-40',
                status?.active && 'bg-sand-100 ring-ink-950 ring-1',
              )}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          );
        })}
      </div>
      {linkOpen && (
        <div className="border-line-200 flex flex-wrap items-end gap-2 border-b p-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <label htmlFor={linkInputId} className="text-small font-medium">
              {t('linkUrl')}
            </label>
            <Input
              id={linkInputId}
              value={linkValue}
              autoFocus
              aria-invalid={linkError || undefined}
              aria-describedby={linkError ? `${linkInputId}-error` : undefined}
              placeholder="/nuoc-hoa, https://…"
              onChange={(event) => setLinkValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setLinkOpen(false);
                  editor?.commands.focus();
                }
              }}
            />
            {linkError && (
              <p id={`${linkInputId}-error`} role="alert" className="text-small text-danger">
                {t('linkInvalid')}
              </p>
            )}
          </div>
          <Button type="button" size="sm" onClick={applyLink}>
            {t('linkApply')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setLinkOpen(false);
              editor?.commands.focus();
            }}
          >
            {t('linkCancel')}
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
