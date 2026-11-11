'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { deleteTopicAction, saveTopicAction } from '@/actions/admin/content';

import { DeleteButton, FormError, SubmitBar, useActionSubmit } from './form-kit';
import {
  TranslationFields,
  type TranslatableForm,
  type TranslationValues,
} from './translation-fields';

const OPTIONS = { content: false, seo: false, excerpt: true };

function payload(values: TranslationValues) {
  return {
    name: values.title,
    slug: values.slug,
    description: values.excerpt || null,
    isPublished: values.isPublished,
  };
}

/** Journal topic editor (name, slug, short description per locale). */
export function TopicForm({ id, defaultValues }: { id?: string; defaultValues: TranslatableForm }) {
  const t = useTranslations('admin.content');
  const form = useForm<TranslatableForm>({ defaultValues });
  const { pending, formError, saved, submit } = useActionSubmit(form, {
    redirectTo: id ? undefined : (newId) => `/admin/content/topics/${newId}`,
  });
  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={form.handleSubmit((values) =>
        submit(() =>
          saveTopicAction({
            id,
            translations: {
              vi: payload(values.translations.vi),
              en: values.hasEn ? payload(values.translations.en) : null,
            },
          }),
        ),
      )}
    >
      <FormError code={formError} />
      <TranslationFields form={form} options={OPTIONS} titleLabel={t('fields.name')} />
      <SubmitBar pending={pending} saved={saved}>
        {id && (
          <DeleteButton action={() => deleteTopicAction(id)} redirectTo="/admin/content/topics" />
        )}
      </SubmitBar>
    </form>
  );
}
