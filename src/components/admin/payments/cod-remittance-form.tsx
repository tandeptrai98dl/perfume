'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo, useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { createCodRemittanceAction } from '@/actions/admin/payments';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { CodCandidateRow } from '@/server/modules/payment';

import { useActionFeedback } from '../form/action-feedback';
import { NumberField, SelectField, TextField } from '../form/fields';
import { VND } from './format';

const CARRIERS = ['ghn', 'ghtk', 'viettel_post', 'self', 'other'] as const;

type Values = {
  carrier: (typeof CARRIERS)[number] | null;
  periodStart: string;
  periodEnd: string;
  receivedAt: string;
  bankReference: string | null;
  carrierFee: number | null;
  totalAmount: number | null;
};

/**
 * COD reconciliation (§3.4 step 6, §11.2): pick the carrier, tick the orders on its
 * statement, compare (Σ COD − fee) with the money on the bank receipt, save.
 */
export function CodRemittanceForm({
  candidates,
  today,
}: {
  candidates: CodCandidateRow[];
  today: string;
}) {
  const t = useTranslations('admin.payments.cod');
  const format = useFormatter();
  const feedback = useActionFeedback();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(candidates.map((c) => [c.orderId, c.amountDue])),
  );
  const form = useForm<Values>({
    defaultValues: {
      carrier: null,
      periodStart: today,
      periodEnd: today,
      receivedAt: today,
      bankReference: null,
      carrierFee: 0,
      totalAmount: null,
    },
  });
  const [carrier, carrierFee, totalAmount] = useWatch({
    control: form.control,
    name: ['carrier', 'carrierFee', 'totalAmount'],
  });

  const visible = useMemo(
    () => candidates.filter((c) => !carrier || !c.carrier || c.carrier === carrier),
    [candidates, carrier],
  );
  const ticked = visible.filter((c) => selected[c.orderId]);
  const collected = ticked.reduce((sum, c) => sum + (amounts[c.orderId] ?? 0), 0);
  const expected = collected - (carrierFee ?? 0);
  const difference = totalAmount === null ? null : totalAmount - expected;
  const allTicked = visible.length > 0 && ticked.length === visible.length;

  function submit(values: Values) {
    startTransition(async () => {
      const result = await createCodRemittanceAction({
        ...values,
        carrierFee: values.carrierFee ?? 0,
        orders: ticked.map((c) => ({ orderId: c.orderId, amount: amounts[c.orderId] ?? 0 })),
      });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('form.done', { count: ticked.length }));
      setSelected({});
      form.reset();
    });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-line-200 flex flex-col gap-6 border bg-white p-6"
    >
      <h2 id={`${id}-title`} className="text-h3">
        {t('form.title')}
      </h2>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField<Values>
              name="carrier"
              label={t('form.carrier')}
              options={CARRIERS.map((value) => ({ value, label: t(`carriers.${value}`) }))}
            />
            <TextField<Values> name="periodStart" type="date" label={t('form.periodStart')} />
            <TextField<Values> name="periodEnd" type="date" label={t('form.periodEnd')} />
            <TextField<Values> name="receivedAt" type="date" label={t('form.receivedAt')} />
            <TextField<Values>
              name="bankReference"
              label={t('form.bankReference')}
              maxLength={100}
              autoComplete="off"
            />
            <NumberField<Values> name="carrierFee" label={t('form.carrierFee')} min={0} />
            <NumberField<Values> name="totalAmount" label={t('form.totalAmount')} min={0} />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-small mb-2 font-medium">{t('form.orders')}</legend>
            {visible.length === 0 ? (
              <p className="text-small text-taupe-600">{t('form.noCandidates')}</p>
            ) : (
              <table className="text-small w-full">
                <thead>
                  <tr className="border-line-200 border-b text-left">
                    <th className="w-12 py-2">
                      <Checkbox
                        aria-label={t('form.selectAll')}
                        checked={allTicked}
                        onCheckedChange={(checked) =>
                          setSelected(
                            Object.fromEntries(visible.map((c) => [c.orderId, checked === true])),
                          )
                        }
                      />
                    </th>
                    <th className="py-2 font-medium">{t('form.orderColumn')}</th>
                    <th className="py-2 font-medium">{t('columns.carrier')}</th>
                    <th className="py-2 font-medium">{t('columns.ordersAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.orderId} className="border-line-200 border-b">
                      <td className="py-2">
                        <Checkbox
                          aria-label={t('form.select', { code: c.code })}
                          checked={!!selected[c.orderId]}
                          onCheckedChange={(checked) =>
                            setSelected((prev) => ({ ...prev, [c.orderId]: checked === true }))
                          }
                        />
                      </td>
                      <td className="py-2">
                        <span className="flex flex-col">
                          <span className="font-mono">{c.code}</span>
                          {c.deliveredAt && (
                            <span className="text-taupe-600">
                              {t('form.delivered', {
                                date: format.dateTime(c.deliveredAt, { dateStyle: 'short' }),
                              })}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2">
                        {c.carrier ? t(`carriers.${c.carrier as 'ghn'}`) : '—'}
                        {c.trackingCode && (
                          <span className="block font-mono text-taupe-600">{c.trackingCode}</span>
                        )}
                      </td>
                      <td className="w-48 py-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={c.amountDue}
                          step={1}
                          aria-label={t('form.orderAmount', { code: c.code })}
                          value={amounts[c.orderId] ?? ''}
                          onChange={(event) =>
                            setAmounts((prev) => ({
                              ...prev,
                              [c.orderId]: Number(event.target.value),
                            }))
                          }
                          className="tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </fieldset>

          <dl
            className="text-small grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2"
            aria-live="polite"
          >
            <dt className="text-taupe-600">{t('form.expected')}</dt>
            <dd className="text-right tabular-nums" data-testid="cod-expected">
              {format.number(expected, VND)}
            </dd>
            <dt className="text-taupe-600">{t('form.received')}</dt>
            <dd className="text-right tabular-nums">
              {totalAmount === null ? '—' : format.number(totalAmount, VND)}
            </dd>
            <dt className="font-medium">{t('form.difference')}</dt>
            <dd
              className={
                difference === 0
                  ? 'text-success text-right font-medium'
                  : 'text-warning text-right font-medium'
              }
              data-testid="cod-difference"
            >
              {difference === null
                ? '—'
                : difference === 0
                  ? t('form.matches')
                  : t('form.mismatch', { amount: format.number(difference, VND) })}
            </dd>
          </dl>

          <Button type="submit" loading={pending} disabled={ticked.length === 0} className="w-fit">
            {t('form.submit')}
          </Button>
        </form>
      </Form>
    </section>
  );
}
