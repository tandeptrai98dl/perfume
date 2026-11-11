'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { requestRefundAction } from '@/actions/admin/payments';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';

import { useActionFeedback } from '../form/action-feedback';
import { NumberField, SelectField, TextareaField, TextField } from '../form/fields';

const METHODS = ['gateway', 'bank_transfer', 'cash'] as const;

type Values = {
  orderCode: string | null;
  amount: number | null;
  reason: string | null;
  method: (typeof METHODS)[number] | null;
};

/** Adds a refund to the queue for an order (cancelled paid order, return, price change). */
export function RequestRefundDialog() {
  const t = useTranslations('admin.payments.refunds');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    defaultValues: { orderCode: null, amount: null, reason: null, method: 'bank_transfer' },
  });

  function submit(values: Values) {
    startTransition(async () => {
      const result = await requestRefundAction(values);
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('request.done'));
      setOpen(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('request.open')}</Button>
      </DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('request.title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
            <TextField<Values>
              name="orderCode"
              label={t('request.orderCode')}
              autoComplete="off"
              placeholder="PF-261111-7K3Q"
              maxLength={40}
            />
            <NumberField<Values> name="amount" label={t('request.amount')} min={1} />
            <SelectField<Values>
              name="method"
              label={t('request.method')}
              options={METHODS.map((value) => ({ value, label: t(`methods.${value}`) }))}
            />
            <TextareaField<Values>
              name="reason"
              label={t('request.reason')}
              rows={2}
              maxLength={500}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {tForm('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('request.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
