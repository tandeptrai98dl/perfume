'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { addOrderNoteAction } from '@/actions/admin/orders';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';

import { useActionFeedback } from '../form/action-feedback';
import { TextareaField } from '../form/fields';

type NoteValues = { message: string };

/** Internal note → order timeline (`order_events.type = 'note'`), staff only. */
export function OrderNoteForm({ orderId }: { orderId: string }) {
  const t = useTranslations('admin.orders.note');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const form = useForm<NoteValues>({ defaultValues: { message: '' } });

  function submit(values: NoteValues) {
    startTransition(async () => {
      const result = await addOrderNoteAction({ orderId, message: values.message });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('done'));
      form.reset();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-3">
        <TextareaField<NoteValues>
          name="message"
          label={t('label')}
          description={t('hint')}
          rows={3}
          maxLength={1000}
        />
        <Button type="submit" variant="secondary" size="sm" loading={pending} className="w-fit">
          {t('submit')}
        </Button>
      </form>
    </Form>
  );
}
