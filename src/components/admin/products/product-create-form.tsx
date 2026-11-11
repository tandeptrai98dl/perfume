'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { createProductAction } from '@/actions/admin/products';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { storefrontPath } from '@/lib/storefront-path';

import { useActionFeedback } from '../form/action-feedback';
import { SelectField, TextField } from '../form/fields';
import { SlugField } from '../form/slug-field';

type CreateValues = {
  brandId: string;
  productLineId: string | null;
  gender: 'male' | 'female' | 'unisex';
  concentration: 'edc' | 'edt' | 'edp' | 'parfum' | 'extrait' | 'other';
  translations: { vi: { name: string; slug: string } };
};

/** Step 1 of a product: identity in Vietnamese; everything else in the editor. */
export function ProductCreateForm({
  brands,
  productLines,
}: {
  brands: { id: string; name: string }[];
  productLines: { id: string; name: string; brandId: string }[];
}) {
  const t = useTranslations('admin.products');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateValues>({
    defaultValues: {
      brandId: '',
      productLineId: null,
      gender: 'unisex',
      concentration: 'edp',
      translations: { vi: { name: '', slug: '' } },
    },
  });
  const brandId = useWatch({ control: form.control, name: 'brandId' });

  function submit(values: CreateValues) {
    startTransition(async () => {
      const result = await createProductAction(values);
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        // Server paths for brand/line are `details.*` in the editor schema.
        for (const issue of result.fieldErrors) {
          if (issue.path === 'details.brandId')
            form.setError('brandId', { message: feedback.message(issue.code) });
          if (issue.path === 'details.productLineId') {
            form.setError('productLineId', { message: feedback.message(issue.code) });
          }
        }
        feedback.fail(result);
        return;
      }
      router.push(`/admin/products/${result.data.id}` as Route);
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="flex max-w-2xl flex-col gap-5"
      >
        <SelectField<CreateValues>
          name="brandId"
          label={t('fields.brand')}
          placeholder={t('fields.brand')}
          options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
        />
        <SelectField<CreateValues>
          name="productLineId"
          label={t('fields.productLine')}
          noneLabel={t('create.noLine')}
          options={productLines
            .filter((line) => line.brandId === brandId)
            .map((line) => ({ value: line.id, label: line.name }))}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField<CreateValues>
            name="concentration"
            label={t('fields.concentration')}
            options={(['edc', 'edt', 'edp', 'parfum', 'extrait', 'other'] as const).map(
              (value) => ({
                value,
                label: t(`concentration.${value}`),
              }),
            )}
          />
          <SelectField<CreateValues>
            name="gender"
            label={t('fields.gender')}
            options={(['male', 'female', 'unisex'] as const).map((value) => ({
              value,
              label: t(`gender.${value}`),
            }))}
          />
        </div>
        <TextField<CreateValues>
          name="translations.vi.name"
          label={t('fields.name')}
          required
          autoComplete="off"
        />
        <SlugField<CreateValues>
          name="translations.vi.slug"
          sourceName="translations.vi.name"
          follow
          previewPrefix={storefrontPath('product', 'vi', '')}
        />
        <div>
          <Button type="submit" loading={pending}>
            {t('create.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
