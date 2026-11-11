'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { deleteCategoryAction, saveCategoryAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import type { CategoryDetail } from '@/server/modules/catalog';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import { NumberField, SelectField } from '../form/fields';
import {
  formTranslationStatus,
  TranslationTabs,
  type ContentLocale,
} from '../form/translation-tabs';
import {
  emptyListingTranslation,
  ListingTranslationFields,
  type ListingTranslationForm,
} from './listing-translation-fields';

type CategoryFormValues = {
  parentId: string | null;
  sortOrder: number;
  translations: { vi: ListingTranslationForm; en: ListingTranslationForm | null };
};

export function CategoryForm({
  category,
  roots,
  appUrl,
}: {
  category: CategoryDetail | null;
  /** Root categories that can be a parent (2-level tree). */
  roots: { id: string; name: string }[];
  appUrl: string;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState<ContentLocale>('vi');
  const form = useForm<CategoryFormValues>({
    defaultValues: {
      parentId: category?.parentId ?? null,
      sortOrder: category?.sortOrder ?? 0,
      translations: {
        vi: category?.translations.vi ?? emptyListingTranslation(true),
        en: category?.translations.en ?? null,
      },
    },
  });
  const values = useWatch({ control: form.control }) as CategoryFormValues;
  const hasChildren = (category?.childCount ?? 0) > 0;

  function submit(data: CategoryFormValues) {
    startTransition(async () => {
      const result = await saveCategoryAction({ id: category?.id ?? null, input: data });
      if (!result.ok) {
        const paths = feedback.applyFieldErrors(form, result, 'input.');
        if (paths.some((path) => path.startsWith('translations.en'))) setLocale('en');
        feedback.fail(result);
        return;
      }
      feedback.success(category ? t('form.saved') : t('form.created'));
      if (category) {
        form.reset(data);
      } else {
        router.replace(`/admin/catalog/categories/${result.data.id}` as Route);
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
        <TranslationTabs
          value={locale}
          onValueChange={setLocale}
          status={{
            vi: formTranslationStatus(values.translations.vi),
            en: formTranslationStatus(values.translations.en),
          }}
          hasEnglish={!!values.translations.en}
          onAddEnglish={() =>
            form.setValue('translations.en', emptyListingTranslation(), { shouldDirty: true })
          }
          onRemoveEnglish={() => form.setValue('translations.en', null, { shouldDirty: true })}
        >
          {(lang) => (
            <ListingTranslationFields<CategoryFormValues>
              lang={lang}
              entity="category"
              value={values.translations[lang]}
              original={category?.translations[lang]}
              appUrl={appUrl}
              nameLabel={t('categories.fields.name')}
              descriptionLabel={t('categories.fields.description')}
            />
          )}
        </TranslationTabs>
        <aside className="flex flex-col gap-5">
          <SelectField<CategoryFormValues>
            name="parentId"
            label={t('categories.fields.parent')}
            noneLabel={t('categories.fields.noParent')}
            disabled={hasChildren}
            description={hasChildren ? t('categories.fields.parentLocked') : undefined}
            options={roots
              .filter((root) => root.id !== category?.id)
              .map((root) => ({ value: root.id, label: root.name }))}
          />
          <NumberField<CategoryFormValues>
            name="sortOrder"
            label={t('categories.fields.sortOrder')}
            nullable={false}
            min={0}
            className="max-w-40"
          />
          <Button type="submit" loading={pending}>
            {category ? t('form.save') : t('form.create')}
          </Button>
          {form.formState.isDirty && (
            <p className="text-small text-taupe-600" role="status">
              {t('form.unsaved')}
            </p>
          )}
          {category && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  {t('form.delete')}
                </Button>
              }
              title={t('categories.deleteTitle', { name: category.translations.vi?.name ?? '' })}
              description={t('categories.deleteDescription')}
              confirmLabel={t('form.delete')}
              confirmText={category.translations.vi?.name}
              onConfirm={async () => {
                const result = await deleteCategoryAction({ id: category.id });
                if (!result.ok) {
                  feedback.fail(result);
                  return false;
                }
                feedback.success(t('form.deleted'));
                router.replace('/admin/catalog/categories' as Route);
              }}
            />
          )}
        </aside>
      </form>
    </Form>
  );
}
