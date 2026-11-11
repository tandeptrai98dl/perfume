'use client';

import { useTranslations } from 'next-intl';
import NextImage from 'next/image';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { deleteBannerAction, saveBannerAction } from '@/actions/admin/content';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import {
  CheckboxRow,
  DeleteButton,
  Field,
  FormError,
  NativeSelect,
  SubmitBar,
  useActionSubmit,
} from './form-kit';
import { MediaSelect, type MediaOption } from './media-select';
import type { BannerFormValues, BannerTranslationValues } from './values';

export type { BannerFormValues } from './values';

import { BANNER_PLACEMENTS as PLACEMENTS, fromAdminInput, type Locale } from './values';

function translationPayload(values: BannerTranslationValues) {
  return {
    title: values.title,
    subtitle: values.subtitle || null,
    ctaLabel: values.ctaLabel || null,
    ctaUrl: values.ctaUrl || null,
    desktopMediaId: values.desktopMediaId || null,
    mobileMediaId: values.mobileMediaId || null,
    isPublished: values.isPublished,
  };
}

/** BannerEditor (§8.4): placement, schedule, vi/en copy and a desktop/mobile preview. */
export function BannerEditor({
  id,
  defaultValues,
  media,
}: {
  id?: string;
  defaultValues: BannerFormValues;
  media: MediaOption[];
}) {
  const t = useTranslations('admin.content');
  const form = useForm<BannerFormValues>({ defaultValues });
  const { register, formState, control } = form;
  const { pending, formError, saved, submit } = useActionSubmit(form, {
    redirectTo: id ? undefined : (newId) => `/admin/content/banners/${newId}`,
  });
  const [previewLocale, setPreviewLocale] = useState<Locale>('vi');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const errors = formState.errors;
  const hasEn = useWatch({ control, name: 'hasEn' });
  const translations = useWatch({ control, name: 'translations' });
  const placement = useWatch({ control, name: 'placement' });
  const preview = translations?.[previewLocale];

  const panel = (locale: Locale) => {
    const e = errors.translations?.[locale];
    const disabled = locale === 'en' && !hasEn;
    return (
      <fieldset disabled={disabled} className="flex flex-col gap-5 pt-6 disabled:opacity-60">
        <legend className="sr-only">{t(`locale.${locale}`)}</legend>
        <Field label={t('fields.title')} error={e?.title?.message}>
          {({ id: fieldId, describedBy, invalid }) => (
            <Input
              id={fieldId}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...register(`translations.${locale}.title`)}
            />
          )}
        </Field>
        <Field label={t('fields.subtitle')} error={e?.subtitle?.message}>
          {({ id: fieldId, describedBy, invalid }) => (
            <Input
              id={fieldId}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...register(`translations.${locale}.subtitle`)}
            />
          )}
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={t('fields.ctaLabel')} error={e?.ctaLabel?.message}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register(`translations.${locale}.ctaLabel`)}
              />
            )}
          </Field>
          <Field label={t('fields.ctaUrl')} hint={t('hints.href')} error={e?.ctaUrl?.message}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register(`translations.${locale}.ctaUrl`)}
              />
            )}
          </Field>
        </div>
        {placement !== 'announcement' && (
          <div className="grid gap-5 md:grid-cols-2">
            <MediaSelect
              label={t('fields.desktopImage')}
              media={media}
              {...register(`translations.${locale}.desktopMediaId`)}
              value={translations?.[locale]?.desktopMediaId}
            />
            <MediaSelect
              label={t('fields.mobileImage')}
              media={media}
              {...register(`translations.${locale}.mobileMediaId`)}
              value={translations?.[locale]?.mobileMediaId}
            />
          </div>
        )}
        <CheckboxRow
          label={t(locale === 'vi' ? 'fields.publishVi' : 'fields.publishEn')}
          {...register(`translations.${locale}.isPublished`)}
        />
        {e?.isPublished?.message && (
          <p className="text-small text-danger" role="alert">
            {t(`errors.${e.isPublished.message as 'vi_required'}`)}
          </p>
        )}
      </fieldset>
    );
  };

  const image = media.find(
    (m) =>
      m.id ===
      (device === 'mobile'
        ? preview?.mobileMediaId || preview?.desktopMediaId
        : preview?.desktopMediaId || preview?.mobileMediaId),
  );

  return (
    <form
      noValidate
      className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_420px]"
      onSubmit={form.handleSubmit((values) =>
        submit(() =>
          saveBannerAction({
            id,
            placement: values.placement,
            position: Number(values.position) || 0,
            isActive: values.isActive,
            startsAt: fromAdminInput(values.startsAt),
            endsAt: fromAdminInput(values.endsAt),
            translations: {
              vi: translationPayload(values.translations.vi),
              en: values.hasEn ? translationPayload(values.translations.en) : null,
            },
          }),
        ),
      )}
    >
      <div className="flex flex-col gap-6">
        <FormError code={formError} />
        <div className="grid gap-5 md:grid-cols-3">
          <Field label={t('fields.placement')} error={errors.placement?.message}>
            {({ id: fieldId }) => (
              <NativeSelect id={fieldId} {...register('placement')}>
                {PLACEMENTS.map((p) => (
                  <option key={p} value={p}>
                    {t(`placement.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('fields.position')} error={errors.position?.message}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                type="number"
                min={0}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register('position')}
              />
            )}
          </Field>
          <CheckboxRow
            className="self-end"
            label={t('fields.isActive')}
            {...register('isActive')}
          />
        </div>
        <fieldset className="grid gap-5 md:grid-cols-2">
          <legend className="text-small mb-2 font-medium">{t('hints.schedule')}</legend>
          <Field label={t('fields.startsAt')} error={errors.startsAt?.message}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                type="datetime-local"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register('startsAt')}
              />
            )}
          </Field>
          <Field label={t('fields.endsAt')} error={errors.endsAt?.message}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                type="datetime-local"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register('endsAt')}
              />
            )}
          </Field>
        </fieldset>
        <Tabs defaultValue="vi">
          <TabsList aria-label={t('translations')}>
            {(['vi', 'en'] as const).map((locale) => (
              <TabsTrigger key={locale} value={locale}>
                {t(`locale.${locale}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="vi" forceMount className="data-[state=inactive]:hidden">
            {panel('vi')}
          </TabsContent>
          <TabsContent value="en" forceMount className="data-[state=inactive]:hidden">
            <CheckboxRow className="pt-6" label={t('fields.hasEn')} {...register('hasEn')} />
            {panel('en')}
          </TabsContent>
        </Tabs>
        <SubmitBar pending={pending} saved={saved}>
          {id && (
            <DeleteButton
              action={() => deleteBannerAction(id)}
              redirectTo="/admin/content/banners"
            />
          )}
        </SubmitBar>
      </div>

      <section
        aria-labelledby="banner-preview"
        className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start"
      >
        <h2 id="banner-preview" className="text-h3">
          {t('preview.title')}
        </h2>
        <div className="flex flex-wrap gap-4">
          <NativeSelect
            aria-label={t('preview.locale')}
            value={previewLocale}
            onChange={(event) => setPreviewLocale(event.target.value as Locale)}
            className="w-auto"
          >
            <option value="vi">{t('locale.vi')}</option>
            <option value="en">{t('locale.en')}</option>
          </NativeSelect>
          <div role="group" aria-label={t('preview.device')} className="flex">
            {(['desktop', 'mobile'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
                className={cn(
                  'text-small border-line-200 min-h-11 border px-4',
                  device === d && 'bg-ink-950 text-ivory-50 border-ink-950',
                )}
              >
                {t(`preview.${d}`)}
              </button>
            ))}
          </div>
        </div>
        <div
          className={cn(
            'border-line-200 mx-auto w-full overflow-hidden border',
            device === 'mobile' ? 'max-w-[375px]' : 'max-w-full',
          )}
        >
          {placement === 'announcement' ? (
            <div className="bg-ink-950 text-ivory-50 text-small px-4 py-3 text-center">
              {preview?.title || t('preview.placeholder')}{' '}
              {preview?.ctaLabel && <span className="underline">{preview.ctaLabel}</span>}
            </div>
          ) : (
            <div
              className={cn(
                'relative',
                device === 'mobile' ? 'aspect-[4/5]' : 'aspect-video',
                image ? 'text-ivory-50' : 'bg-sand-100 text-ink-950',
              )}
            >
              {image && (
                <NextImage src={image.url} alt="" fill unoptimized className="object-cover" />
              )}
              <div
                className={cn(
                  'absolute inset-0 flex flex-col justify-end gap-2 p-5',
                  image && 'bg-overlay',
                )}
              >
                <p className="font-display text-h2">{preview?.title || t('preview.placeholder')}</p>
                {preview?.subtitle && <p className="text-small">{preview.subtitle}</p>}
                {preview?.ctaLabel && (
                  <span className="text-button inline-flex w-fit border border-current px-4 py-2 uppercase">
                    {preview.ctaLabel}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </form>
  );
}
