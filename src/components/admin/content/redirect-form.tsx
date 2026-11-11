'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { createRedirectAction } from '@/actions/admin/content';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Field, FormError, NativeSelect, useActionSubmit } from './form-kit';

type Values = { fromPath: string; toPath: string; statusCode: string };

/** Create (or update) a redirect. Chains are collapsed on the server. */
export function RedirectForm() {
  const t = useTranslations('admin.content');
  const form = useForm<Values>({ defaultValues: { fromPath: '', toPath: '', statusCode: '301' } });
  const { pending, formError, submit } = useActionSubmit(form);
  const errors = form.formState.errors;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) =>
        submit(async () => {
          const result = await createRedirectAction({
            ...values,
            statusCode: Number(values.statusCode),
          });
          if (result.ok) form.reset();
          return result;
        }),
      )}
    >
      <FormError code={formError} />
      <div className="grid items-start gap-4 md:grid-cols-[1fr_1fr_10rem_auto]">
        <Field
          label={t('fields.fromPath')}
          hint={t('hints.fromPath')}
          error={errors.fromPath?.message}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              placeholder="/san-pham/ten-cu"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...form.register('fromPath')}
            />
          )}
        </Field>
        <Field label={t('fields.toPath')} hint={t('hints.href')} error={errors.toPath?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              placeholder="/san-pham/ten-moi"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              {...form.register('toPath')}
            />
          )}
        </Field>
        <Field label={t('fields.statusCode')} error={errors.statusCode?.message}>
          {({ id }) => (
            <NativeSelect id={id} {...form.register('statusCode')}>
              {['301', '302', '307', '308'].map((code) => (
                <option key={code} value={code}>
                  {t(`statusCodes.${code as '301'}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" loading={pending} className="md:mt-7">
          {t('redirects.create')}
        </Button>
      </div>
    </form>
  );
}
