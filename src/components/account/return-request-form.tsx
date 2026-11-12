'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  RETURN_PHOTO_ACCEPT,
  RETURN_PHOTO_LIMIT,
  RETURN_PHOTO_MAX_BYTES,
  RETURN_REQUEST_PATH,
  type ReturnRequestResponse,
} from '@/lib/returns-request';
import { cn } from '@/lib/utils';

import { FormNotice } from './form-message';

/*
 * ReturnRequestForm (ADR-0017, §10.5): lines + quantities, reason, refund or replacement (for
 * the shop's fault), description, seal confirmation for change-of-mind returns, up to three
 * photos (JPEG/PNG/WebP ≤ 8 MB; stored privately, seen by staff only). Posted as multipart to
 * `POST /api/returns/request`; validation is repeated on the server, errors come back as
 * `returns.errors.*` codes.
 */

const REASONS = ['unopened', 'defective', 'wrong_item', 'damaged'] as const;
type Reason = (typeof REASONS)[number];
const DESCRIPTION_MAX = 1000;

export type ReturnFormItem = {
  id: string;
  productName: string;
  variantLabel: string;
  quantity: number;
};

type Failure = Extract<ReturnRequestResponse, { ok: false }>;

const PHOTO_TYPES = RETURN_PHOTO_ACCEPT.split(',');

async function postRequest(body: FormData): Promise<ReturnRequestResponse> {
  try {
    const response = await fetch(RETURN_REQUEST_PATH, { method: 'POST', body });
    return (await response.json()) as ReturnRequestResponse;
  } catch {
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}

export function ReturnRequestForm({
  code,
  token,
  items,
}: {
  code: string;
  /** Signed order link token for guests (the lookup cookie works without it). */
  token?: string | null;
  items: ReturnFormItem[];
}) {
  const t = useTranslations('returns');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>(
    items.length === 1 ? { [items[0]!.id]: items[0]!.quantity } : {},
  );
  const [reason, setReason] = useState<Reason | null>(null);
  const [resolution, setResolution] = useState<'refund' | 'replacement'>('refund');
  const [description, setDescription] = useState('');
  const [sealIntact, setSealIntact] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const fault = reason !== null && reason !== 'unopened';

  const message = (code: string | undefined) => {
    const key = (code ?? 'unexpected') as 'unexpected';
    return t.has(`errors.${key}`) ? t(`errors.${key}`) : t('errors.unexpected');
  };
  const fieldError = (path: string) =>
    failure?.fieldErrors.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const lines = Object.entries(selected)
      .filter(([, quantity]) => quantity > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    const body = new FormData();
    body.set(
      'payload',
      JSON.stringify({
        code,
        token: token ?? null,
        request: {
          lines,
          reason,
          resolution: fault ? resolution : 'refund',
          description,
          sealIntact: reason === 'unopened' && sealIntact,
        },
      }),
    );
    for (const photo of photos) body.append('photos', photo);
    startTransition(async () => {
      const result = await postRequest(body);
      if (result.ok) {
        // The order page shows the request's progress from now on.
        router.refresh();
        setFailure(null);
        toast.success(t('form.done'));
        return;
      }
      setFailure(result);
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        aria-expanded={false}
        aria-controls={`${id}-form`}
        onClick={() => setOpen(true)}
      >
        {t('start')}
      </Button>
    );
  }

  const linesError = fieldError('request.lines');
  const reasonError = fieldError('request.reason');
  const descriptionError = fieldError('request.description');
  const sealError = fieldError('request.sealIntact');
  const photosServerError = fieldError('request.photos');
  const photosMessage = photoError ?? (photosServerError ? message(photosServerError.code) : null);

  function addPhotos(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.some((file) => !PHOTO_TYPES.includes(file.type))) {
      setPhotoError(t('errors.photoType'));
      return;
    }
    if (picked.some((file) => file.size > RETURN_PHOTO_MAX_BYTES)) {
      setPhotoError(t('errors.photoTooLarge'));
      return;
    }
    const next = [...photos, ...picked];
    if (next.length > RETURN_PHOTO_LIMIT) {
      setPhotoError(t('errors.tooManyPhotos'));
      return;
    }
    setPhotoError(null);
    setPhotos(next);
  }

  return (
    <form
      method="post"
      id={`${id}-form`}
      onSubmit={submit}
      noValidate
      className="border-line-200 flex flex-col gap-6 border bg-white p-5"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="text-h3">
        {t('form.title', { code })}
      </h3>

      {failure && failure.error !== 'validation' && (
        <FormNotice tone="error">{message(failure.error)}</FormNotice>
      )}

      <fieldset className="flex flex-col gap-3" aria-describedby={`${id}-lines-hint`}>
        <legend className="font-medium">{t('form.lines')}</legend>
        <p id={`${id}-lines-hint`} className="text-small text-taupe-600">
          {t('form.linesHint')}
        </p>
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const name = `${item.productName} ${item.variantLabel}`.trim();
            const checked = (selected[item.id] ?? 0) > 0;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3">
                <div className="flex min-h-11 flex-1 items-center gap-3">
                  <Checkbox
                    id={`${id}-line-${item.id}`}
                    checked={checked}
                    onCheckedChange={(value) =>
                      setSelected((current) => ({
                        ...current,
                        [item.id]: value === true ? current[item.id] || item.quantity : 0,
                      }))
                    }
                  />
                  <Label htmlFor={`${id}-line-${item.id}`} className="cursor-pointer">
                    {t('form.lineLabel', { name, quantity: item.quantity })}
                  </Label>
                </div>
                {checked && item.quantity > 1 && (
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={item.quantity}
                    value={selected[item.id]}
                    aria-label={t('form.quantity', { name })}
                    className="w-24"
                    onChange={(event) => {
                      const value = Math.min(
                        item.quantity,
                        Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                      );
                      setSelected((current) => ({ ...current, [item.id]: value }));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {linesError && (
          <p role="alert" className="text-small text-danger">
            {message(linesError.code)}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">{t('form.reason')}</legend>
        <RadioGroup
          value={reason ?? ''}
          onValueChange={(value) => setReason(value as Reason)}
          aria-invalid={!!reasonError || undefined}
        >
          {REASONS.map((value) => (
            <div key={value} className="flex min-h-11 items-center gap-3">
              <RadioGroupItem id={`${id}-reason-${value}`} value={value} />
              <Label htmlFor={`${id}-reason-${value}`} className="cursor-pointer">
                {t(`reasons.${value}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {reasonError && (
          <p role="alert" className="text-small text-danger">
            {message(reasonError.code)}
          </p>
        )}
      </fieldset>

      {fault ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium">{t('form.resolution')}</legend>
          <RadioGroup
            value={resolution}
            onValueChange={(value) => setResolution(value as 'refund' | 'replacement')}
          >
            {(['refund', 'replacement'] as const).map((value) => (
              <div key={value} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem id={`${id}-resolution-${value}`} value={value} />
                <Label htmlFor={`${id}-resolution-${value}`} className="cursor-pointer">
                  {t(`resolutions.${value}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      ) : (
        reason === 'unopened' && (
          <div className="flex flex-col gap-2">
            <p className="text-small text-taupe-600">{t('form.resolutionUnopened')}</p>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={`${id}-seal`}
                checked={sealIntact}
                onCheckedChange={(value) => setSealIntact(value === true)}
                aria-invalid={!!sealError || undefined}
                aria-describedby={sealError ? `${id}-seal-error` : undefined}
              />
              <Label htmlFor={`${id}-seal`} className="cursor-pointer">
                {t('form.sealIntact')}
              </Label>
            </div>
            {sealError && (
              <p id={`${id}-seal-error`} role="alert" className="text-small text-danger">
                {message(sealError.code)}
              </p>
            )}
          </div>
        )
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>{t('form.description')}</Label>
        <Textarea
          id={`${id}-description`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          onChange={(event) => setDescription(event.target.value)}
          aria-invalid={!!descriptionError || undefined}
          aria-describedby={`${id}-description-hint`}
        />
        <p
          id={`${id}-description-hint`}
          className={cn('text-small', descriptionError ? 'text-danger' : 'text-taupe-600')}
          role={descriptionError ? 'alert' : undefined}
        >
          {descriptionError
            ? message(descriptionError.code)
            : fault
              ? t('form.descriptionFault')
              : t('form.descriptionOptional')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-photos`}>{t('form.photos')}</Label>
        <input
          id={`${id}-photos`}
          type="file"
          accept={RETURN_PHOTO_ACCEPT}
          multiple
          disabled={photos.length >= RETURN_PHOTO_LIMIT}
          aria-describedby={`${id}-photos-hint`}
          aria-invalid={!!photosMessage || undefined}
          className="text-small file:border-line-200 file:text-small file:mr-3 file:min-h-11 file:border file:bg-white file:px-4 file:py-2 disabled:opacity-60"
          onChange={(event) => {
            addPhotos(event.target.files);
            event.target.value = '';
          }}
        />
        <p
          id={`${id}-photos-hint`}
          className={cn('text-small', photosMessage ? 'text-danger' : 'text-taupe-600')}
          role={photosMessage ? 'alert' : undefined}
        >
          {photosMessage ?? t('form.photosHint', { max: RETURN_PHOTO_LIMIT })}
        </p>
        {photos.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t('form.photosSelected')}>
            {photos.map((photo, index) => (
              <li key={`${photo.name}-${index}`} className="flex flex-wrap items-center gap-3">
                <span className="text-small min-w-0 flex-1 break-all">{photo.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('form.removePhotoLabel', { name: photo.name })}
                  onClick={() => {
                    setPhotoError(null);
                    setPhotos((current) => current.filter((_, i) => i !== index));
                  }}
                >
                  {t('form.removePhoto')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-small text-taupe-600">{t('form.estimate')}</p>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          {t('form.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
