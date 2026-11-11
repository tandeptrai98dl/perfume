'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { deleteCollectionAction, saveCollectionAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import type { CollectionDetail } from '@/server/modules/catalog';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import { SwitchField, TextField } from '../form/fields';
import {
  formTranslationStatus,
  TranslationTabs,
  type ContentLocale,
} from '../form/translation-tabs';
import { SingleImageField, type ImageValue } from '../media/single-image-field';
import {
  emptyListingTranslation,
  ListingTranslationFields,
  type ListingTranslationForm,
} from './listing-translation-fields';

type CollectionFormValues = {
  isActive: boolean;
  /** `datetime-local` value in the admin's time zone (Asia/Ho_Chi_Minh). */
  startsAt: string;
  endsAt: string;
  hero: ImageValue;
  translations: { vi: ListingTranslationForm; en: ListingTranslationForm | null };
};

const VN_OFFSET = '+07:00';

/** Date → `YYYY-MM-DDTHH:mm` in Vietnam time (UTC+7, no DST). */
function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? `${value}:00${VN_OFFSET}` : null;
}

export function CollectionForm({
  collection,
  appUrl,
}: {
  collection: CollectionDetail | null;
  appUrl: string;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState<ContentLocale>('vi');
  const form = useForm<CollectionFormValues>({
    defaultValues: {
      isActive: collection?.isActive ?? true,
      startsAt: toLocalInput(collection?.startsAt ?? null),
      endsAt: toLocalInput(collection?.endsAt ?? null),
      hero: collection?.hero
        ? { id: collection.hero.id, url: collection.hero.url, alt: collection.hero.alt.vi }
        : null,
      translations: {
        vi: collection?.translations.vi ?? emptyListingTranslation(true),
        en: collection?.translations.en ?? null,
      },
    },
  });
  const values = useWatch({ control: form.control }) as CollectionFormValues;

  function submit(data: CollectionFormValues) {
    startTransition(async () => {
      const result = await saveCollectionAction({
        id: collection?.id ?? null,
        input: {
          isActive: data.isActive,
          startsAt: fromLocalInput(data.startsAt),
          endsAt: fromLocalInput(data.endsAt),
          heroMediaId: data.hero?.id ?? null,
          translations: data.translations,
        },
      });
      if (!result.ok) {
        const paths = feedback.applyFieldErrors(form, result, 'input.');
        if (paths.some((path) => path.startsWith('translations.en'))) setLocale('en');
        feedback.fail(result);
        return;
      }
      feedback.success(collection ? t('form.saved') : t('form.created'));
      if (collection) {
        form.reset(data);
      } else {
        router.replace(`/admin/catalog/collections/${result.data.id}` as Route);
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
            <ListingTranslationFields<CollectionFormValues>
              lang={lang}
              entity="collection"
              value={values.translations[lang]}
              original={collection?.translations[lang]}
              appUrl={appUrl}
              nameLabel={t('collections.fields.name')}
              descriptionLabel={t('collections.fields.description')}
            />
          )}
        </TranslationTabs>
        <aside className="flex flex-col gap-5">
          <SwitchField<CollectionFormValues>
            name="isActive"
            label={t('collections.fields.isActive')}
          />
          <TextField<CollectionFormValues>
            name="startsAt"
            type="datetime-local"
            label={t('collections.fields.startsAt')}
          />
          <TextField<CollectionFormValues>
            name="endsAt"
            type="datetime-local"
            label={t('collections.fields.endsAt')}
          />
          <SingleImageField
            label={t('collections.fields.hero')}
            value={values.hero}
            altVi={values.translations.vi.name}
            onChange={(hero) => form.setValue('hero', hero, { shouldDirty: true })}
          />
          <Button type="submit" loading={pending}>
            {collection ? t('form.save') : t('form.create')}
          </Button>
          {form.formState.isDirty && (
            <p className="text-small text-taupe-600" role="status">
              {t('form.unsaved')}
            </p>
          )}
          {collection && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  {t('form.delete')}
                </Button>
              }
              title={t('collections.deleteTitle', { name: collection.translations.vi?.name ?? '' })}
              description={t('collections.deleteDescription')}
              confirmLabel={t('form.delete')}
              confirmText={collection.translations.vi?.name}
              onConfirm={async () => {
                const result = await deleteCollectionAction({ id: collection.id });
                if (!result.ok) {
                  feedback.fail(result);
                  return false;
                }
                feedback.success(t('form.deleted'));
                router.replace('/admin/catalog/collections' as Route);
              }}
            />
          )}
        </aside>
      </form>
    </Form>
  );
}
