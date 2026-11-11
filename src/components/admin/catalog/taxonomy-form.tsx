'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { deleteTaxonomyAction, saveTaxonomyAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import type { TaxonomyDetail, TaxonomyKind } from '@/server/modules/catalog';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import {
  formTranslationStatus,
  TranslationTabs,
  type ContentLocale,
} from '../form/translation-tabs';
import { SingleImageField, type ImageValue } from '../media/single-image-field';
import { ListingTranslationFields } from './listing-translation-fields';

type TaxonomyTranslationForm = { name: string; slug: string; description: string | null };
type TaxonomyFormValues = {
  image: ImageValue;
  translations: { vi: TaxonomyTranslationForm; en: TaxonomyTranslationForm | null };
};

const BASE: Record<TaxonomyKind, string> = {
  family: '/admin/catalog/families',
  note: '/admin/catalog/notes',
};

const empty = (): TaxonomyTranslationForm => ({ name: '', slug: '', description: null });

/** Scent family or note: vi/en name, slug, description and an image. */
export function TaxonomyForm({
  kind,
  item,
  appUrl,
}: {
  kind: TaxonomyKind;
  item: TaxonomyDetail | null;
  appUrl: string;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState<ContentLocale>('vi');
  const form = useForm<TaxonomyFormValues>({
    defaultValues: {
      image: item?.image
        ? { id: item.image.id, url: item.image.url, alt: item.image.alt.vi }
        : null,
      translations: { vi: item?.translations.vi ?? empty(), en: item?.translations.en ?? null },
    },
  });
  const values = useWatch({ control: form.control }) as TaxonomyFormValues;
  const name = item?.translations.vi?.name ?? '';

  function submit(data: TaxonomyFormValues) {
    startTransition(async () => {
      const result = await saveTaxonomyAction({
        kind,
        id: item?.id ?? null,
        input: { imageMediaId: data.image?.id ?? null, translations: data.translations },
      });
      if (!result.ok) {
        const paths = feedback.applyFieldErrors(form, result, 'input.');
        if (paths.some((path) => path.startsWith('translations.en'))) setLocale('en');
        feedback.fail(result);
        return;
      }
      feedback.success(item ? t('form.saved') : t('form.created'));
      if (item) {
        form.reset(data);
      } else {
        router.replace(`${BASE[kind]}/${result.data.id}` as Route);
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
          onAddEnglish={() => form.setValue('translations.en', empty(), { shouldDirty: true })}
          onRemoveEnglish={() => form.setValue('translations.en', null, { shouldDirty: true })}
        >
          {(lang) => (
            <ListingTranslationFields<TaxonomyFormValues>
              lang={lang}
              entity={kind === 'family' ? 'family' : null}
              value={values.translations[lang]}
              original={item?.translations[lang]}
              appUrl={appUrl}
              nameLabel={t('taxonomy.fields.name')}
              descriptionLabel={t('taxonomy.fields.description')}
              seo={false}
            />
          )}
        </TranslationTabs>
        <aside className="flex flex-col gap-5">
          <SingleImageField
            label={t('taxonomy.fields.image')}
            value={values.image}
            altVi={values.translations.vi.name}
            onChange={(image) => form.setValue('image', image, { shouldDirty: true })}
          />
          <Button type="submit" loading={pending}>
            {item ? t('form.save') : t('form.create')}
          </Button>
          {form.formState.isDirty && (
            <p className="text-small text-taupe-600" role="status">
              {t('form.unsaved')}
            </p>
          )}
          {item && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  {t('form.delete')}
                </Button>
              }
              title={t(`taxonomy.${kind}.deleteTitle`, { name })}
              description={t(`taxonomy.${kind}.deleteDescription`)}
              confirmLabel={t('form.delete')}
              confirmText={name}
              onConfirm={async () => {
                const result = await deleteTaxonomyAction({ kind, id: item.id });
                if (!result.ok) {
                  feedback.fail(result);
                  return false;
                }
                feedback.success(t('form.deleted'));
                router.replace(BASE[kind] as Route);
              }}
            />
          )}
        </aside>
      </form>
    </Form>
  );
}
