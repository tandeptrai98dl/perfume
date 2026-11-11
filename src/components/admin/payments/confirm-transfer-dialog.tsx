'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { confirmBankTransferAction } from '@/actions/admin/payments';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';

import { useActionFeedback } from '../form/action-feedback';
import { NumberField, TextareaField, TextField } from '../form/fields';
import { VND } from './format';

type Values = { amount: number | null; bankReference: string | null; note: string | null };

/** Manager confirms money seen on the bank statement for an order (§3.4 step 7). */
export function ConfirmTransferDialog({
  order,
  trigger,
}: {
  order: { orderId: string; code: string; amountDue: number };
  trigger: ReactNode;
}) {
  const t = useTranslations('admin.payments.bankTransfers.confirm');
  const tForm = useTranslations('admin.form');
  const format = useFormatter();
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    defaultValues: { amount: order.amountDue, bankReference: null, note: null },
  });

  function submit(values: Values) {
    startTransition(async () => {
      const result = await confirmBankTransferAction({ orderId: order.orderId, ...values });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(
        t('done', { amount: format.number(values.amount ?? 0, VND), code: order.code }),
      );
      setOpen(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('title')}</DialogTitle>
          <DialogDescription>
            {t('summary', { code: order.code, due: format.number(order.amountDue, VND) })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
            <NumberField<Values> name="amount" label={t('amount')} min={1} max={order.amountDue} />
            <TextField<Values>
              name="bankReference"
              label={t('bankReference')}
              maxLength={100}
              autoComplete="off"
            />
            <TextareaField<Values> name="note" label={t('note')} rows={2} maxLength={500} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {tForm('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
