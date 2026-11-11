'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { completeRefundAction } from '@/actions/admin/payments';
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
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import { useActionFeedback } from '../form/action-feedback';
import { TextField } from '../form/fields';
import { SingleImageField, type ImageValue } from '../media/single-image-field';
import { VND } from './format';

type Values = { mode: 'gateway' | 'manual'; providerRef: string | null; proof: ImageValue };

/** Completes a queued refund: through the gateway API (VNPay) or recorded as manual. */
export function CompleteRefundDialog({
  refund,
  gatewayProvider,
  trigger,
}: {
  refund: { id: string; orderCode: string; amount: number };
  /** Provider whose refund API can be called for this refund, if any. */
  gatewayProvider: string | null;
  trigger: ReactNode;
}) {
  const t = useTranslations('admin.payments');
  const tForm = useTranslations('admin.form');
  const format = useFormatter();
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    defaultValues: { mode: gatewayProvider ? 'gateway' : 'manual', providerRef: null, proof: null },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const proof = useWatch({ control: form.control, name: 'proof' });

  function submit(values: Values) {
    startTransition(async () => {
      const result = await completeRefundAction({
        refundId: refund.id,
        mode: values.mode,
        providerRef: values.mode === 'manual' ? values.providerRef : null,
        proofMediaId: values.mode === 'manual' ? (values.proof?.id ?? null) : null,
      });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      if (result.data.status === 'failed') {
        toast.error(t('refunds.complete.failed', { error: result.data.error ?? '' }));
        setOpen(false);
        return;
      }
      feedback.success(t('refunds.complete.done'));
      setOpen(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('refunds.complete.title')}</DialogTitle>
          <DialogDescription>
            {t('refunds.complete.summary', {
              amount: format.number(refund.amount, VND),
              code: refund.orderCode,
            })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('refunds.complete.mode')}</FormLabel>
                  <FormControl>
                    <RadioGroup value={field.value} onValueChange={field.onChange}>
                      {gatewayProvider && (
                        <label className="text-small flex min-h-11 items-center gap-2">
                          <RadioGroupItem value="gateway" />
                          {t('refunds.complete.modeGateway', {
                            provider: t(`providers.${gatewayProvider as 'vnpay'}`),
                          })}
                        </label>
                      )}
                      <label className="text-small flex min-h-11 items-center gap-2">
                        <RadioGroupItem value="manual" />
                        {t('refunds.complete.modeManual')}
                      </label>
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />
            {mode === 'manual' && (
              <>
                <TextField<Values>
                  name="providerRef"
                  label={t('refunds.complete.providerRef')}
                  description={t('refunds.complete.providerRefHint')}
                  maxLength={100}
                  autoComplete="off"
                />
                <SingleImageField
                  label={t('refunds.complete.proof')}
                  value={proof}
                  onChange={(value) => form.setValue('proof', value)}
                />
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {tForm('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('refunds.complete.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
