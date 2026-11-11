'use client';

import { ImagePlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import { useActionFeedback } from '../form/action-feedback';
import { ACCEPT_IMAGES, uploadImage } from './upload';

export type ImageValue = { id: string; url: string; alt?: string | null } | null;

/** One image (brand logo, collection cover, family image): upload, preview, remove. */
export function SingleImageField({
  label,
  value,
  onChange,
  altVi,
}: {
  label: string;
  value: ImageValue;
  onChange: (value: ImageValue) => void;
  altVi?: string;
}) {
  const t = useTranslations('admin');
  const feedback = useActionFeedback();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function upload(file: File) {
    setBusy(true);
    setStatus(t('products.media.uploading', { name: file.name }));
    const result = await uploadImage(file, altVi);
    setBusy(false);
    if (result.ok) {
      onChange({ id: result.data.id, url: result.data.url, alt: altVi });
      setStatus(t('products.media.uploaded', { name: file.name }));
    } else {
      setStatus('');
      feedback.fail(result);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-small font-medium" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex items-center gap-4">
        <div className="border-line-200 bg-sand-100 flex size-24 items-center justify-center overflow-hidden border">
          {value ? (
            // Admin thumbnail of an already re-encoded upload; next/image is not needed here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.url} alt={value.alt ?? ''} className="size-full object-contain" />
          ) : (
            <ImagePlus aria-hidden className="size-6 text-taupe-600" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={ACCEPT_IMAGES}
            className="sr-only"
            aria-labelledby={`${id}-label`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => input.current?.click()}
          >
            {t('form.upload')}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X aria-hidden />
              {t('form.removeImage')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-small text-taupe-600" aria-live="polite">
        {busy && <Spinner className="mr-2 inline" />}
        {status}
      </p>
    </div>
  );
}
