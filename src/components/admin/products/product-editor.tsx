'use client';

import { parseAsStringLiteral, useQueryState } from 'nuqs';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  deleteProductAction,
  duplicateProductAction,
  saveProductAction,
  setProductStatusAction,
} from '@/actions/admin/products';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { docToPlainText } from '@/lib/plain-text-doc';
import { storefrontPath } from '@/lib/storefront-path';
import type { ProductEditorOptions, ProductForEdit } from '@/server/modules/catalog';

import { useCan } from '../admin-session';
import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import {
  CheckboxGroupField,
  NumberField,
  SelectField,
  SwitchField,
  RichTextField,
  TextareaField,
  TextField,
} from '../form/fields';
import { SeoFields } from '../form/seo-fields';
import { SlugField } from '../form/slug-field';
import {
  formTranslationStatus,
  TranslationTabs,
  type ContentLocale,
} from '../form/translation-tabs';
import { StatusBadge } from '../status-badge';
import {
  EDITOR_TABS,
  emptyEditorTranslation,
  tabForPath,
  toEditorValues,
  toSavePayload,
  type ProductEditorValues,
} from './editor-values';
import { MediaUploader } from './media-uploader';
import { ScentEditor } from './scent-editor';
import { VariantMatrixEditor } from './variant-matrix-editor';

const GENDERS = ['male', 'female', 'unisex'] as const;
const CONCENTRATIONS = ['edc', 'edt', 'edp', 'parfum', 'extrait', 'other'] as const;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const OCCASIONS = ['day', 'night', 'office', 'casual', 'date', 'special'] as const;
const RATINGS = ['1', '2', '3', '4', '5'];

/**
 * ProductEditor (§11.2): Details, Variants & prices, Scent, Media, SEO and Compliance tabs,
 * saved together with an optimistic lock. Status changes, duplicate and delete are separate
 * actions on the saved product.
 */
export function ProductEditor({
  data,
  options,
  appUrl,
}: {
  data: ProductForEdit;
  options: ProductEditorOptions;
  appUrl: string;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const canEditPrices = useCan('products.editPrices');
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(EDITOR_TABS).withDefault('details'),
  );
  const [locale, setLocale] = useState<ContentLocale>('vi');
  const [saving, startSaving] = useTransition();
  const [acting, startAction] = useTransition();
  const form = useForm<ProductEditorValues>({ defaultValues: toEditorValues(data) });
  const values = useWatch({ control: form.control }) as ProductEditorValues;
  const { product } = data;
  const name = data.translations.vi?.name ?? '';
  const dirty = form.formState.isDirty;

  function revealErrors(paths: string[]) {
    const first = paths[0];
    if (!first) return;
    void setTab(tabForPath(first));
    if (first.startsWith('translations.en')) setLocale('en');
    else if (first.startsWith('translations.vi')) setLocale('vi');
  }

  function submit(formValues: ProductEditorValues) {
    startSaving(async () => {
      const result = await saveProductAction(toSavePayload(product.id, formValues));
      if (!result.ok) {
        revealErrors(feedback.applyFieldErrors(form, result));
        feedback.fail(result);
        return;
      }
      feedback.success(t('form.saved'));
      // The action refreshes the page: the editor remounts with the server's ids and timestamps.
      form.reset({ ...formValues, expectedUpdatedAt: result.data.updatedAt });
    });
  }

  function changeStatus(status: 'draft' | 'active' | 'archived') {
    startAction(async () => {
      const result = await setProductStatusAction({ id: product.id, status });
      if (!result.ok) {
        feedback.fail(result);
        return;
      }
      feedback.success(t('products.actions.statusChanged'));
    });
  }

  const brandLines = options.productLines.filter((line) => line.brandId === values.details.brandId);
  const categoryOptions = options.categories.map((c) => ({
    value: c.id,
    label: c.name,
    indent: !!c.parentId,
  }));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-6">
        <div className="border-line-200 sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b bg-white px-4 py-3 lg:-mx-8 lg:px-8">
          <StatusBadge status={product.status} />
          <span className="text-small text-taupe-600" role="status">
            {dirty ? t('form.unsaved') : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {product.status !== 'active' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={dirty}
                title={dirty ? t('products.actions.saveFirst') : undefined}
                loading={acting}
                onClick={() => changeStatus('active')}
              >
                {t('products.actions.publish')}
              </Button>
            )}
            {product.status === 'active' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={dirty}
                onClick={() => changeStatus('draft')}
              >
                {t('products.actions.unpublish')}
              </Button>
            )}
            {product.status !== 'archived' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={dirty}
                onClick={() => changeStatus('archived')}
              >
                {t('products.actions.archive')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={dirty}
              onClick={() =>
                startAction(async () => {
                  const result = await duplicateProductAction({ id: product.id });
                  if (!result.ok) {
                    feedback.fail(result);
                    return;
                  }
                  feedback.success(t('products.actions.duplicated'));
                  router.push(`/admin/products/${result.data.id}` as Route);
                })
              }
            >
              {t('products.actions.duplicate')}
            </Button>
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  {t('products.actions.delete')}
                </Button>
              }
              title={t('products.actions.deleteTitle', { name })}
              description={t('products.actions.deleteDescription')}
              confirmLabel={t('form.delete')}
              confirmText={name}
              onConfirm={async () => {
                const result = await deleteProductAction({ id: product.id });
                if (!result.ok) {
                  feedback.fail(result);
                  return false;
                }
                feedback.success(t('form.deleted'));
                router.replace('/admin/products' as Route);
              }}
            />
            <Button type="submit" size="sm" loading={saving}>
              {t('form.save')}
            </Button>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(next) => void setTab(next as (typeof EDITOR_TABS)[number])}
        >
          <TabsList className="flex-wrap gap-x-6 gap-y-0">
            {EDITOR_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`products.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="details" className="grid gap-8 lg:grid-cols-[1fr_20rem]">
            <TranslationTabs
              value={locale}
              onValueChange={setLocale}
              status={{
                vi: formTranslationStatus(values.translations.vi),
                en: formTranslationStatus(values.translations.en),
              }}
              hasEnglish={!!values.translations.en}
              onAddEnglish={() =>
                form.setValue('translations.en', emptyEditorTranslation(), { shouldDirty: true })
              }
              onRemoveEnglish={() => form.setValue('translations.en', null, { shouldDirty: true })}
            >
              {(lang) => {
                const prefix = `translations.${lang}` as const;
                const original = data.translations[lang];
                return (
                  <>
                    <TextField<ProductEditorValues>
                      name={`${prefix}.name`}
                      label={t('products.fields.name')}
                      required
                      autoComplete="off"
                    />
                    <SlugField<ProductEditorValues>
                      name={`${prefix}.slug`}
                      sourceName={`${prefix}.name`}
                      follow={!original}
                      originalSlug={original?.slug}
                      published={!!original?.isPublished && product.status === 'active'}
                      previewPrefix={storefrontPath('product', lang, '')}
                    />
                    <TextField<ProductEditorValues>
                      name={`${prefix}.subtitle`}
                      label={t('products.fields.subtitle')}
                    />
                    <RichTextField<ProductEditorValues>
                      name={`${prefix}.description`}
                      label={t('products.fields.description')}
                      description={t('products.fields.descriptionHint')}
                    />
                    <SwitchField<ProductEditorValues>
                      name={`${prefix}.isPublished`}
                      label={t('translation.isPublished', {
                        locale: t(`translation.locale.${lang}`),
                      })}
                    />
                  </>
                );
              }}
            </TranslationTabs>
            <aside className="flex flex-col gap-5">
              <SelectField<ProductEditorValues>
                name="details.brandId"
                label={t('products.fields.brand')}
                options={options.brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              />
              <SelectField<ProductEditorValues>
                name="details.productLineId"
                label={t('products.fields.productLine')}
                noneLabel={t('products.create.noLine')}
                options={brandLines.map((line) => ({ value: line.id, label: line.name }))}
              />
              <SelectField<ProductEditorValues>
                name="details.concentration"
                label={t('products.fields.concentration')}
                options={CONCENTRATIONS.map((value) => ({
                  value,
                  label: t(`products.concentration.${value}`),
                }))}
              />
              <SelectField<ProductEditorValues>
                name="details.gender"
                label={t('products.fields.gender')}
                options={GENDERS.map((value) => ({ value, label: t(`products.gender.${value}`) }))}
              />
              <NumberField<ProductEditorValues>
                name="details.releaseYear"
                label={t('products.fields.releaseYear')}
                min={1700}
                max={2100}
              />
              <TextField<ProductEditorValues>
                name="details.perfumer"
                label={t('products.fields.perfumer')}
              />
              <RatingSelect name="details.longevity" label={t('products.fields.longevity')} />
              <RatingSelect name="details.sillage" label={t('products.fields.sillage')} />
              <SwitchField<ProductEditorValues>
                name="details.isFeatured"
                label={t('products.fields.featured')}
              />
            </aside>
            <div className="flex flex-col gap-6 lg:col-span-2">
              <CheckboxGroupField<ProductEditorValues>
                name="details.categoryIds"
                label={t('products.fields.categories')}
                options={categoryOptions}
              />
              <CheckboxGroupField<ProductEditorValues>
                name="details.seasons"
                label={t('products.fields.seasons')}
                options={SEASONS.map((value) => ({ value, label: t(`products.seasons.${value}`) }))}
              />
              <CheckboxGroupField<ProductEditorValues>
                name="details.occasions"
                label={t('products.fields.occasions')}
                options={OCCASIONS.map((value) => ({
                  value,
                  label: t(`products.occasions.${value}`),
                }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="variants">
            <VariantMatrixEditor canEditPrices={canEditPrices} />
          </TabsContent>

          <TabsContent value="scent">
            <ScentEditor notes={options.notes} families={options.families} />
          </TabsContent>

          <TabsContent value="media">
            <MediaUploader />
          </TabsContent>

          <TabsContent value="seo">
            <TranslationTabs
              value={locale}
              onValueChange={setLocale}
              status={{
                vi: formTranslationStatus(values.translations.vi),
                en: formTranslationStatus(values.translations.en),
              }}
              hasEnglish={!!values.translations.en}
              onAddEnglish={() =>
                form.setValue('translations.en', emptyEditorTranslation(), { shouldDirty: true })
              }
              onRemoveEnglish={() => form.setValue('translations.en', null, { shouldDirty: true })}
            >
              {(lang) => (
                <SeoFields<ProductEditorValues>
                  prefix={`translations.${lang}`}
                  fallbackTitle={values.translations[lang]?.name ?? ''}
                  fallbackDescription={docToPlainText(
                    values.translations[lang]?.description ?? null,
                  )}
                  url={`${appUrl}${storefrontPath('product', lang, values.translations[lang]?.slug ?? '')}`}
                />
              )}
            </TranslationTabs>
          </TabsContent>

          <TabsContent value="compliance" className="flex max-w-3xl flex-col gap-5">
            <p className="text-small text-taupe-600">{t('products.compliance.hint')}</p>
            <TextField<ProductEditorValues>
              name="compliance.countryOfOrigin"
              label={t('products.compliance.countryOfOrigin')}
            />
            <TextField<ProductEditorValues>
              name="compliance.responsibleImporter"
              label={t('products.compliance.importer')}
            />
            <TextField<ProductEditorValues>
              name="compliance.cosmeticNotificationNo"
              label={t('products.compliance.notificationNo')}
            />
            <TextareaField<ProductEditorValues>
              name="compliance.ingredients"
              label={t('products.compliance.ingredients')}
              rows={6}
            />
            <TextareaField<ProductEditorValues>
              name="compliance.warnings"
              label={t('products.compliance.warnings')}
              rows={4}
            />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

function RatingSelect({
  name,
  label,
}: {
  name: 'details.longevity' | 'details.sillage';
  label: string;
}) {
  const t = useTranslations('admin.products.fields');
  return (
    <SelectField<ProductEditorValues>
      name={name}
      label={label}
      noneLabel={t('notSet')}
      numeric
      options={RATINGS.map((value) => ({ value, label: value }))}
    />
  );
}
