'use client';

import { useTranslations } from 'next-intl';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';

import { RichTextEditor } from '@/components/admin/rich-text-editor';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { slugify } from '@/lib/slug';

import { CheckboxRow, Field } from './form-kit';
import type { Locale, TranslatableForm, TranslationValues } from './values';

export type { TranslatableForm, TranslationValues } from './values';

type Options = { excerpt?: boolean; content?: boolean; seo?: boolean; slug?: boolean };

/**
 * vi/en tabs with the translatable fields (TranslationTabs, §8.4). Vietnamese is required;
 * English is optional and only visible on the storefront when published (ADR-0021).
 */
export function TranslationFields<T extends TranslatableForm>({
  form: anyForm,
  options = {},
  titleLabel,
}: {
  form: UseFormReturn<T>;
  options?: Options;
  titleLabel?: string;
}) {
  const form = anyForm as unknown as UseFormReturn<TranslatableForm>;
  const t = useTranslations('admin.content');
  const { register, control, formState, setValue, getValues } = form;
  const hasEn = useWatch({ control, name: 'hasEn' });
  const show = { excerpt: false, content: true, seo: true, slug: true, ...options };

  const panel = (locale: Locale) => {
    const errors = formState.errors.translations?.[locale];
    const disabled = locale === 'en' && !hasEn;
    return (
      <fieldset disabled={disabled} className="flex flex-col gap-5 pt-6 disabled:opacity-60">
        <legend className="sr-only">{t(`locale.${locale}`)}</legend>
        <Field label={titleLabel ?? t('fields.title')} error={errors?.title?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...register(`translations.${locale}.title`, {
                onBlur: (event: { target: { value: string } }) => {
                  if (show.slug && !getValues(`translations.${locale}.slug`)) {
                    setValue(`translations.${locale}.slug`, slugify(event.target.value));
                  }
                },
              })}
            />
          )}
        </Field>
        {show.slug && (
          <Field label={t('fields.slug')} hint={t('hints.slug')} error={errors?.slug?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register(`translations.${locale}.slug`)}
              />
            )}
          </Field>
        )}
        {show.excerpt && (
          <Field label={t('fields.excerpt')} error={errors?.excerpt?.message}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={3}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                {...register(`translations.${locale}.excerpt`)}
              />
            )}
          </Field>
        )}
        {show.content && (
          <Field label={t('fields.content')} error={errors?.content?.message}>
            {({ id, describedBy, invalid }) => (
              <Controller
                control={control}
                name={`translations.${locale}.content`}
                render={({ field }) => (
                  <RichTextEditor
                    id={id}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={disabled}
                  />
                )}
              />
            )}
          </Field>
        )}
        {show.seo && (
          <div className="grid gap-5 md:grid-cols-2">
            <Field
              label={t('fields.seoTitle')}
              hint={t('hints.seoTitle')}
              error={errors?.seoTitle?.message}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  maxLength={70}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  {...register(`translations.${locale}.seoTitle`)}
                />
              )}
            </Field>
            <Field
              label={t('fields.seoDescription')}
              hint={t('hints.seoDescription')}
              error={errors?.seoDescription?.message}
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={160}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  {...register(`translations.${locale}.seoDescription`)}
                />
              )}
            </Field>
          </div>
        )}
        <CheckboxRow
          label={t(locale === 'vi' ? 'fields.publishVi' : 'fields.publishEn')}
          {...register(`translations.${locale}.isPublished`)}
        />
        {errors?.isPublished?.message && (
          <p className="text-small text-danger" role="alert">
            {t(`errors.${errors.isPublished.message as 'vi_required'}`)}
          </p>
        )}
      </fieldset>
    );
  };

  return (
    <Tabs defaultValue="vi">
      <TabsList aria-label={t('translations')}>
        {(['vi', 'en'] as const).map((locale) => (
          <TabsTrigger key={locale} value={locale}>
            {t(`locale.${locale}`)}
            {formState.errors.translations?.[locale] && (
              <span className="text-danger ms-1" aria-label={t('hasErrors')}>
                •
              </span>
            )}
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
  );
}

/** Form values → action payload for one translation (empty strings → null). */
export function translationPayload(
  values: TranslationValues,
  options: Options = {},
): Record<string, unknown> {
  const show = { excerpt: false, content: true, seo: true, slug: true, ...options };
  return {
    title: values.title,
    ...(show.slug ? { slug: values.slug } : {}),
    ...(show.excerpt ? { excerpt: values.excerpt || null } : {}),
    ...(show.content ? { content: values.content } : {}),
    ...(show.seo
      ? { seoTitle: values.seoTitle || null, seoDescription: values.seoDescription || null }
      : {}),
    isPublished: values.isPublished,
  };
}
