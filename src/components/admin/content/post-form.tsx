'use client';

import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';

import { deletePostAction, savePostAction } from '@/actions/admin/content';
import { Input } from '@/components/ui/input';

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
import { fromAdminInput } from './values';
import { TranslationFields, translationPayload, type TranslatableForm } from './translation-fields';

export type PostFormValues = TranslatableForm & {
  status: 'draft' | 'active' | 'archived';
  /** `datetime-local` value. */
  publishedAt: string;
  coverMediaId: string;
  topicIds: string[];
  productIds: string[];
};

type Option = { id: string; name: string };

/** Journal post editor: translations, schedule, cover, topics and linked products. */
export function PostForm({
  id,
  defaultValues,
  media,
  topics,
  products,
}: {
  id?: string;
  defaultValues: PostFormValues;
  media: MediaOption[];
  topics: Option[];
  products: Option[];
}) {
  const t = useTranslations('admin.content');
  const form = useForm<PostFormValues>({ defaultValues });
  const { pending, formError, saved, submit } = useActionSubmit(form, {
    redirectTo: id ? undefined : (newId) => `/admin/content/posts/${newId}`,
  });
  const errors = form.formState.errors;
  const options = { excerpt: true };
  const coverMediaId = useWatch({ control: form.control, name: 'coverMediaId' });

  return (
    <form
      noValidate
      className="flex max-w-4xl flex-col gap-6"
      onSubmit={form.handleSubmit((values) =>
        submit(() =>
          savePostAction({
            id,
            status: values.status,
            publishedAt: fromAdminInput(values.publishedAt),
            coverMediaId: values.coverMediaId || null,
            topicIds: values.topicIds,
            productIds: values.productIds,
            translations: {
              vi: translationPayload(values.translations.vi, options),
              en: values.hasEn ? translationPayload(values.translations.en, options) : null,
            },
          }),
        ),
      )}
    >
      <FormError code={formError} />
      <div className="grid gap-5 md:grid-cols-2">
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
        <Field
          label={t('fields.publishedAt')}
          hint={t('hints.publishedAt')}
          error={errors.publishedAt?.message}
        >
          {({ id: fieldId, describedBy, invalid }) => (
            <Input
              id={fieldId}
              type="datetime-local"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...form.register('publishedAt')}
            />
          )}
        </Field>
      </div>
      <MediaSelect
        label={t('fields.cover')}
        media={media}
        error={errors.coverMediaId?.message}
        {...form.register('coverMediaId')}
        value={coverMediaId}
      />
      <TranslationFields form={form} options={options} />
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-small mb-2 font-medium">{t('fields.topics')}</legend>
          {topics.length === 0 && <p className="text-small text-taupe-600">{t('empty.topics')}</p>}
          {topics.map((topic) => (
            <CheckboxRow
              key={topic.id}
              label={topic.name}
              value={topic.id}
              {...form.register('topicIds')}
            />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-small mb-2 font-medium">{t('fields.products')}</legend>
          <p className="text-small mb-2 text-taupe-600">{t('hints.products')}</p>
          <div className="border-line-200 max-h-64 overflow-y-auto border px-3">
            {products.map((product) => (
              <CheckboxRow
                key={product.id}
                label={product.name}
                value={product.id}
                {...form.register('productIds')}
              />
            ))}
          </div>
        </fieldset>
      </div>
      <SubmitBar pending={pending} saved={saved}>
        {id && (
          <DeleteButton action={() => deletePostAction(id)} redirectTo="/admin/content/posts" />
        )}
      </SubmitBar>
    </form>
  );
}
