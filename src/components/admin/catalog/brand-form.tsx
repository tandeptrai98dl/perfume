'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { deleteBrandAction, saveBrandAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { docToPlainText, plainTextToDoc } from '@/lib/plain-text-doc';
import { storefrontPath } from '@/lib/storefront-path';
import type { BrandDetail } from '@/server/modules/catalog';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import { SelectField, SwitchField, TextareaField, TextField } from '../form/fields';
import { SeoFields } from '../form/seo-fields';
import { SlugField } from '../form/slug-field';
import {
  formTranslationStatus,
  TranslationTabs,
  type ContentLocale,
} from '../form/translation-tabs';
import { SingleImageField, type ImageValue } from '../media/single-image-field';

type BrandTranslationForm = {
  slug: string;
  story: string;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
};

export type BrandFormValues = {
  name: string;
  country: string;
  isFeatured: boolean;
  status: 'draft' | 'active' | 'archived';
  logo: ImageValue;
  translations: { vi: BrandTranslationForm; en: BrandTranslationForm | null };
};

const emptyTranslation = (slug = '', isPublished = false): BrandTranslationForm => ({
  slug,
  story: '',
  seoTitle: null,
  seoDescription: null,
  isPublished,
});

function toForm(brand: BrandDetail | null): BrandFormValues {
  const tr = (value: BrandDetail['translations']['vi']): BrandTranslationForm | null =>
    value && {
      slug: value.slug,
      story: docToPlainText(value.story),
      seoTitle: value.seoTitle,
      seoDescription: value.seoDescription,
      isPublished: value.isPublished,
    };
  return {
    name: brand?.name ?? '',
    country: brand?.country ?? '',
    isFeatured: brand?.isFeatured ?? false,
    status: brand?.status ?? 'draft',
    logo: brand?.logo ? { id: brand.logo.id, url: brand.logo.url, alt: brand.logo.alt.vi } : null,
    translations: {
      vi: (brand && tr(brand.translations.vi)) ?? emptyTranslation('', true),
      en: brand ? tr(brand.translations.en) : null,
    },
  };
}

export function BrandForm({ brand, appUrl }: { brand: BrandDetail | null; appUrl: string }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState<ContentLocale>('vi');
  const form = useForm<BrandFormValues>({ defaultValues: toForm(brand) });
  const values = useWatch({ control: form.control }) as BrandFormValues;

  function submit(data: BrandFormValues) {
    const tr = (value: BrandTranslationForm | null) =>
      value && { ...value, story: plainTextToDoc(value.story) };
    startTransition(async () => {
      const result = await saveBrandAction({
        id: brand?.id ?? null,
        input: {
          name: data.name,
          country: data.country,
          isFeatured: data.isFeatured,
          status: data.status,
          logoMediaId: data.logo?.id ?? null,
          translations: { vi: tr(data.translations.vi), en: tr(data.translations.en) },
        },
      });
      if (!result.ok) {
        const paths = feedback.applyFieldErrors(form, result, 'input.');
        if (paths.some((path) => path.startsWith('translations.en'))) setLocale('en');
        else if (paths.some((path) => path.startsWith('translations.vi'))) setLocale('vi');
        feedback.fail(result);
        return;
      }
      if (brand) {
        feedback.success(t('form.saved'));
        form.reset(data);
        router.refresh();
      } else {
        feedback.success(t('form.created'));
        router.replace(`/admin/catalog/brands/${result.data.id}` as Route);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="grid gap-8 lg:grid-cols-[1fr_20rem]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <TextField<BrandFormValues>
            name="name"
            label={t('brands.fields.name')}
            description={t('brands.fields.nameHint')}
            required
            autoComplete="off"
          />
          <TranslationTabs
            value={locale}
            onValueChange={setLocale}
            status={{
              vi: formTranslationStatus(values.translations.vi),
              en: formTranslationStatus(values.translations.en),
            }}
            hasEnglish={!!values.translations.en}
            onAddEnglish={() =>
              form.setValue('translations.en', emptyTranslation(values.translations.vi.slug), {
                shouldDirty: true,
              })
            }
            onRemoveEnglish={() => form.setValue('translations.en', null, { shouldDirty: true })}
          >
            {(lang) => {
              const prefix = `translations.${lang}` as const;
              const original = brand?.translations[lang];
              return (
                <>
                  <SlugField<BrandFormValues>
                    name={`${prefix}.slug`}
                    sourceName="name"
                    follow={!original}
                    originalSlug={original?.slug}
                    published={original?.isPublished}
                    previewPrefix={storefrontPath('brand', lang, '')}
                  />
                  <TextareaField<BrandFormValues>
                    name={`${prefix}.story`}
                    label={t('brands.fields.story')}
                    rows={8}
                  />
                  <SeoFields<BrandFormValues>
                    prefix={prefix}
                    fallbackTitle={values.name}
                    fallbackDescription={values.translations[lang]?.story}
                    url={`${appUrl}${storefrontPath('brand', lang, values.translations[lang]?.slug ?? '')}`}
                  />
                  <SwitchField<BrandFormValues>
                    name={`${prefix}.isPublished`}
                    label={t('translation.isPublished', {
                      locale: t(`translation.locale.${lang}`),
                    })}
                  />
                </>
              );
            }}
          </TranslationTabs>
        </div>

        <aside className="flex flex-col gap-5">
          <SelectField<BrandFormValues>
            name="status"
            label={t('brands.fields.status')}
            options={(['draft', 'active', 'archived'] as const).map((value) => ({
              value,
              label: t(`status.${value}`),
            }))}
          />
          <TextField<BrandFormValues>
            name="country"
            label={t('brands.fields.country')}
            maxLength={2}
            autoComplete="off"
            className="max-w-40"
          />
          <SwitchField<BrandFormValues> name="isFeatured" label={t('brands.fields.featured')} />
          <SingleImageField
            label={t('brands.fields.logo')}
            value={values.logo}
            altVi={values.name}
            onChange={(logo) => form.setValue('logo', logo, { shouldDirty: true })}
          />
          <div className="flex flex-col gap-3">
            <Button type="submit" loading={pending}>
              {brand ? t('form.save') : t('form.create')}
            </Button>
            {form.formState.isDirty && (
              <p className="text-small text-taupe-600" role="status">
                {t('form.unsaved')}
              </p>
            )}
            {brand && (
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost">
                    {t('form.delete')}
                  </Button>
                }
                title={t('brands.deleteTitle', { name: brand.name })}
                description={t('brands.deleteDescription')}
                confirmLabel={t('form.delete')}
                confirmText={brand.name}
                onConfirm={async () => {
                  const result = await deleteBrandAction({ id: brand.id });
                  if (!result.ok) {
                    feedback.fail(result);
                    return false;
                  }
                  feedback.success(t('form.deleted'));
                  router.replace('/admin/catalog/brands' as Route);
                }}
              />
            )}
          </div>
        </aside>
      </form>
    </Form>
  );
}
