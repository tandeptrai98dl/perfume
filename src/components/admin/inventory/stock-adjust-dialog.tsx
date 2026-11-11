'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { adjustStockAction, setLowStockThresholdAction } from '@/actions/admin/inventory';
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
import { NumberField, SelectField, TextareaField } from '../form/fields';

const REASONS = ['purchase', 'return', 'damage', 'adjustment'] as const;

type AdjustValues = {
  mode: 'delta' | 'set';
  quantity: number | null;
  reason: (typeof REASONS)[number] | null;
  note: string | null;
};

export type StockTarget = {
  variantId: string;
  sku: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
};

/** StockAdjustDialog (§8.4): reason required; delta or counted quantity; never below zero. */
export function StockAdjustDialog({
  target,
  trigger,
}: {
  target: StockTarget;
  trigger: ReactNode;
}) {
  const t = useTranslations('admin.inventory');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [thresholdPending, startThreshold] = useTransition();
  const form = useForm<AdjustValues>({
    defaultValues: { mode: 'delta', quantity: null, reason: null, note: null },
  });
  const thresholdForm = useForm<{ lowStockThreshold: number | null }>({
    defaultValues: { lowStockThreshold: target.lowStockThreshold },
  });
  const [mode, quantity] = useWatch({ control: form.control, name: ['mode', 'quantity'] });
  const after =
    quantity === null || Number.isNaN(quantity)
      ? null
      : mode === 'set'
        ? quantity
        : target.onHand + quantity;

  function submit(values: AdjustValues) {
    startTransition(async () => {
      const result = await adjustStockAction({ variantId: target.variantId, ...values });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('adjust.done', { sku: target.sku, onHand: result.data.onHand }));
      setOpen(false);
      form.reset();
    });
  }

  function saveThreshold(values: { lowStockThreshold: number | null }) {
    startThreshold(async () => {
      const result = await setLowStockThresholdAction({
        variantId: target.variantId,
        lowStockThreshold: values.lowStockThreshold ?? 0,
      });
      if (!result.ok) {
        feedback.applyFieldErrors(thresholdForm, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('threshold.saved'));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('adjust.title')}</DialogTitle>
          <DialogDescription>
            {t('adjust.summary', {
              sku: target.sku,
              onHand: target.onHand,
              reserved: target.reserved,
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
                  <FormLabel>{t('adjust.mode')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="flex flex-wrap gap-6"
                    >
                      {(['delta', 'set'] as const).map((value) => (
                        <label key={value} className="text-small flex min-h-11 items-center gap-2">
                          <RadioGroupItem value={value} />
                          {value === 'delta' ? t('adjust.modeDelta') : t('adjust.modeSet')}
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />
            <NumberField<AdjustValues>
              name="quantity"
              label={t('adjust.quantity')}
              description={
                mode === 'set' ? t('adjust.quantityHintSet') : t('adjust.quantityHintDelta')
              }
              min={mode === 'set' ? 0 : undefined}
            />
            <SelectField<AdjustValues>
              name="reason"
              label={t('adjust.reason')}
              placeholder={tForm('choose')}
              options={REASONS.map((value) => ({ value, label: t(`reasons.${value}`) }))}
            />
            <TextareaField<AdjustValues>
              name="note"
              label={t('adjust.note')}
              rows={2}
              maxLength={500}
            />
            <p className="text-small" aria-live="polite">
              {after !== null && t('adjust.preview', { onHand: after })}
            </p>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {tForm('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('adjust.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        <Form {...thresholdForm}>
          <form
            onSubmit={thresholdForm.handleSubmit(saveThreshold)}
            noValidate
            className="border-line-200 flex flex-wrap items-end gap-3 border-t pt-5"
          >
            <NumberField<{ lowStockThreshold: number | null }>
              name="lowStockThreshold"
              label={t('threshold.label', { sku: target.sku })}
              min={0}
              className="w-56"
            />
            <Button type="submit" variant="secondary" size="sm" loading={thresholdPending}>
              {t('threshold.save')}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
