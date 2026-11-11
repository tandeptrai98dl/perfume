'use client';

import { ImagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import { useActionFeedback } from '../form/action-feedback';
import { TextField } from '../form/fields';
import { ACCEPT_IMAGES, uploadImage } from '../media/upload';
import { SortableList } from '../sortable-list';
import type { ProductEditorValues } from './editor-values';

const ALL = '__all__';

/**
 * MediaUploader (§8.4): drag & drop or pick images; each is validated and re-encoded on the
 * server. Order (first = cover), alt text per locale and an optional variant link are part of
 * the product form and saved with it.
 */
export function MediaUploader() {
  const t = useTranslations('admin.products');
  const feedback = useActionFeedback();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const form = useFormContext<ProductEditorValues>();
  const { fields, append, move, remove } = useFieldArray({
    control: form.control,
    name: 'media',
    keyName: 'key',
  });
  const variants = useWatch({ control: form.control, name: 'variants' });
  const productName = useWatch({ control: form.control, name: 'translations.vi.name' });
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function uploadFiles(files: File[]) {
    setBusy(true);
    for (const file of files) {
      setStatus(t('media.uploading', { name: file.name }));
      const result = await uploadImage(file, productName);
      if (result.ok) {
        append({
          mediaId: result.data.id,
          url: result.data.url,
          width: result.data.width,
          height: result.data.height,
          variantIndex: null,
          alt: { vi: productName || file.name, en: null },
        });
        setStatus(t('media.uploaded', { name: file.name }));
      } else {
        const reason = feedback.message(result.fieldErrors[0]?.code ?? result.error);
        setStatus(t('media.failed', { name: file.name, reason }));
        feedback.fail(result);
      }
    }
    setBusy(false);
  }

  const variantOptions = [
    ...variants.map((variant, index) => ({
      value: String(index),
      label: variant.sku || t('variants.row', { index: index + 1 }),
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const files = [...event.dataTransfer.files].filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length > 0) void uploadFiles(files);
        }}
        className={cn(
          'border-line-200 flex flex-col items-center gap-3 border border-dashed px-6 py-10 text-center',
          dragOver && 'border-ink-950 bg-sand-100',
        )}
      >
        <ImagePlus aria-hidden className="size-8 text-taupe-600" />
        <p id={`${id}-hint`} className="text-small max-w-md text-taupe-600">
          {t('media.dropHint')}
        </p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_IMAGES}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) void uploadFiles(files);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          aria-describedby={`${id}-hint`}
          onClick={() => input.current?.click()}
        >
          {t('media.choose')}
        </Button>
        <p className="text-small" aria-live="polite">
          {busy && <Spinner className="mr-2 inline" />}
          {status}
        </p>
      </div>

      {fields.length === 0 ? (
        <p className="text-small text-taupe-600">{t('media.empty')}</p>
      ) : (
        <SortableList
          items={fields}
          getKey={(item) => item.key}
          onMove={move}
          onRemove={remove}
          onMoved={(_, position) => setStatus(t('media.imageLabel', { index: position }))}
          labels={(_, index) => ({
            up: t('media.moveUp', { index: index + 1 }),
            down: t('media.moveDown', { index: index + 1 }),
            remove: t('media.remove', { index: index + 1 }),
          })}
          renderItem={(item, index) => (
            <div className="grid gap-4 py-1 md:grid-cols-[6rem_1fr]">
              <figure className="flex flex-col gap-1">
                {/* Admin preview of an already re-encoded upload. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt=""
                  className="border-line-200 bg-sand-100 aspect-[4/5] w-24 border object-cover"
                />
                <figcaption className="text-small text-taupe-600">
                  {index === 0 ? t('media.cover') : t('media.imageLabel', { index: index + 1 })}
                  {item.width && item.height ? (
                    <span className="block tabular-nums">
                      {t('media.dimensions', { width: item.width, height: item.height })}
                    </span>
                  ) : null}
                </figcaption>
              </figure>
              <div className="grid gap-3 lg:grid-cols-2">
                <TextField<ProductEditorValues>
                  name={`media.${index}.alt.vi`}
                  label={t('media.altVi')}
                />
                <TextField<ProductEditorValues>
                  name={`media.${index}.alt.en`}
                  label={t('media.altEn')}
                />
                <MediaVariantSelect index={index} options={variantOptions} />
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}

function MediaVariantSelect({
  index,
  options,
}: {
  index: number;
  options: { value: string; label: string }[];
}) {
  const t = useTranslations('admin.products.media');
  const form = useFormContext<ProductEditorValues>();
  return (
    <FormField
      control={form.control}
      name={`media.${index}.variantIndex`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('variant')}</FormLabel>
          <Select
            value={field.value === null ? ALL : String(field.value)}
            onValueChange={(next) => field.onChange(next === ALL ? null : Number(next))}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={ALL}>{t('allVariants')}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
