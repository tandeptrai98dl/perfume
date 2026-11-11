'use client';

import { useTranslations } from 'next-intl';
import NextImage from 'next/image';
import type { ComponentProps } from 'react';

import { Field, NativeSelect } from './form-kit';

export type MediaOption = { id: string; url: string; alt: string | null };

/**
 * Picks an uploaded image (media library, stream "media upload") with a small preview.
 * Uploading happens in the media library; this only references existing media.
 */
export function MediaSelect({
  label,
  media,
  error,
  value,
  ...props
}: Omit<ComponentProps<'select'>, 'value'> & {
  label: string;
  media: MediaOption[];
  error?: string;
  value: string | null | undefined;
}) {
  const t = useTranslations('admin.content');
  const selected = media.find((m) => m.id === value);
  return (
    <div className="flex items-end gap-4">
      <Field
        className="flex-1"
        label={label}
        error={error}
        hint={media.length === 0 ? t('hints.noMedia') : undefined}
      >
        {({ id, describedBy, invalid }) => (
          <NativeSelect
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value ?? ''}
            {...props}
          >
            <option value="">{t('fields.noImage')}</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alt || m.url.split('/').pop()}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {selected && (
        <div className="bg-sand-100 relative size-16 shrink-0 overflow-hidden">
          <NextImage src={selected.url} alt="" fill unoptimized className="object-cover" />
        </div>
      )}
    </div>
  );
}
