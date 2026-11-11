'use client';

import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * Manually ordered list (collections, product images): drag and drop with the mouse, or the
 * up/down buttons from the keyboard. Moves are announced through `onMoved`.
 */
export function SortableList<T>({
  items,
  getKey,
  onChange,
  onMove,
  onRemove,
  renderItem,
  labels,
  onMoved,
  className,
}: {
  items: T[];
  getKey: (item: T) => string;
  /** Receives the reordered list; or use `onMove`/`onRemove` (e.g. RHF useFieldArray). */
  onChange?: (items: T[]) => void;
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  labels: (item: T, index: number) => { up: string; down: string; remove?: string };
  onMoved?: (item: T, position: number) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    const moved = items[from];
    if (onMove) onMove(from, to);
    else onChange?.(moveItem(items, from, to));
    if (moved !== undefined) onMoved?.(moved, to + 1);
  }

  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {items.map((item, index) => {
        const label = labels(item, index);
        return (
          <li
            key={getKey(item)}
            draggable
            onDragStart={(event) => {
              setDragging(index);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(index);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null) move(dragging, index);
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            className={cn(
              'border-line-200 flex items-center gap-2 border bg-white p-2',
              dragging === index && 'opacity-50',
              over === index && dragging !== index && 'border-ink-950',
            )}
          >
            <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-taupe-600" />
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
            <IconButton
              aria-label={label.up}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp aria-hidden />
            </IconButton>
            <IconButton
              aria-label={label.down}
              disabled={index === items.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown aria-hidden />
            </IconButton>
            {label.remove && (
              <IconButton
                aria-label={label.remove}
                onClick={() =>
                  onRemove ? onRemove(index) : onChange?.(items.filter((_, i) => i !== index))
                }
              >
                <X aria-hidden />
              </IconButton>
            )}
          </li>
        );
      })}
    </ol>
  );
}
