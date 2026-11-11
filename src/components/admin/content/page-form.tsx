'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { deletePageAction, savePageAction } from '@/actions/admin/content';
import { Input } from '@/components/ui/input';

import {
  DeleteButton,
  Field,
  FormError,
  NativeSelect,
  SubmitBar,
  useActionSubmit,
} from './form-kit';
import { TranslationFields, translationPayload, type TranslatableForm } from './translation-fields';

export type PageFormValues = TranslatableForm & {
  key: string;
  status: 'draft' | 'active' | 'archived';
};

/** Static page editor (information pages and policies), vi/en. */
export function PageForm({ id, defaultValues }: { id?: string; defaultValues: PageFormValues }) {
  const t = useTranslations('admin.content');
  const form = useForm<PageFormValues>({ defaultValues });
  const { pending, formError, saved, submit } = useActionSubmit(form, {
    redirectTo: id ? undefined : (newId) => `/admin/content/pages/${newId}`,
  });
  const errors = form.formState.errors;

  return (
    <form
      noValidate
      className="flex max-w-4xl flex-col gap-6"
      onSubmit={form.handleSubmit((values) =>
        submit(() =>
          savePageAction({
            id,
            key: values.key,
            status: values.status,
            translations: {
              vi: translationPayload(values.translations.vi),
              en: values.hasEn ? translationPayload(values.translations.en) : null,
            },
          }),
        ),
      )}
    >
      <FormError code={formError} />
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t('fields.key')} hint={t('hints.pageKey')} error={errors.key?.message}>
          {({ id: fieldId, describedBy, invalid }) => (
            <Input
              id={fieldId}
              list="page-keys"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...form.register('key')}
            />
          )}
        </Field>
        <datalist id="page-keys">
          {[
            'about',
            'authenticity',
            'contact',
            'faq',
            'terms',
            'privacy',
            'returns',
            'shipping',
            'payment',
            'cookies',
          ].map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
        <Field label={t('fields.status')} error={errors.status?.message}>
          {({ id: fieldId }) => (
            <NativeSelect id={fieldId} {...form.register('status')}>
              {(['draft', 'active', 'archived'] as const).map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <TranslationFields form={form} />
      <SubmitBar pending={pending} saved={saved}>
        {id && (
          <DeleteButton action={() => deletePageAction(id)} redirectTo="/admin/content/pages" />
        )}
      </SubmitBar>
    </form>
  );
}
