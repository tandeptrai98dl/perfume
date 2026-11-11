'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import {
  cancelOrderAction,
  changeOrderStatusAction,
  shipOrderAction,
} from '@/actions/admin/orders';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Carrier, OrderStatus } from '@/server/modules/order';

import { useActionFeedback } from '../form/action-feedback';
import { NumberField, SelectField, TextField } from '../form/fields';
import { useOrderFormat } from './format';

const CARRIERS = [
  'ghn',
  'ghtk',
  'viettel_post',
  'self',
  'other',
] as const satisfies readonly Carrier[];

type ButtonTarget =
  'confirmed' | 'processing' | 'delivered' | 'delivery_failed' | 'returned' | 'return_requested';

/** Targets confirmed with one click: the fast path of "confirm → pack → tracking" (§11). */
const ONE_CLICK: readonly ButtonTarget[] = ['confirmed', 'processing'];

type OrderRef = { id: string; code: string; version: number; status: OrderStatus };

export type OrderActionsProps = {
  order: OrderRef;
  nextStatuses: OrderStatus[];
  amountPaid: number;
  depositOutstanding: number;
  codToCollect: number;
  canCancelPaid: boolean;
};

/**
 * OrderStatusActions + ShipmentForm (§8.4): only the transitions the state machine allows for
 * this role; every action sends the loaded `version` (optimistic lock).
 */
export function OrderActions({
  order,
  nextStatuses,
  amountPaid,
  depositOutstanding,
  codToCollect,
  canCancelPaid,
}: OrderActionsProps) {
  const t = useTranslations('admin.orders');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const [pending, startTransition] = useTransition();

  function done(status: OrderStatus) {
    feedback.success(t('actions.done', { code: order.code, status: t(`status.${status}`) }));
  }

  async function transition(to: OrderStatus, reason: string | null): Promise<boolean> {
    const result = await changeOrderStatusAction({
      orderId: order.id,
      expectedVersion: order.version,
      to,
      reason,
    });
    if (!result.ok) {
      feedback.fail(result);
      return false;
    }
    done(result.data.status);
    return true;
  }

  const buttons = nextStatuses.filter(
    (to): to is ButtonTarget => to !== 'shipped' && to !== 'cancelled',
  );
  const confirmBlocked = depositOutstanding > 0;

  return (
    <div className="flex flex-col gap-4">
      {nextStatuses.includes('confirmed') && confirmBlocked && (
        <p className="border-warning text-small text-warning border-l-2 pl-3" role="note">
          {t('detail.depositMissing', { amount: format.vnd(depositOutstanding) })}
        </p>
      )}
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {buttons.map((to) =>
            ONE_CLICK.includes(to) ? (
              <Button
                key={to}
                disabled={to === 'confirmed' && confirmBlocked}
                loading={pending}
                onClick={() => startTransition(async () => void (await transition(to, null)))}
              >
                {t(`actions.${to}`)}
              </Button>
            ) : (
              <TransitionDialog
                key={to}
                trigger={
                  <Button variant={to === 'delivery_failed' ? 'secondary' : 'primary'}>
                    {t(`actions.${to}`)}
                  </Button>
                }
                title={t('actions.dialogTitle', { action: t(`actions.${to}`) })}
                description={t('actions.dialogDescription', {
                  code: order.code,
                  status: t(`status.${to}`),
                })}
                note={
                  to === 'returned'
                    ? t('actions.restock')
                    : to === 'delivery_failed'
                      ? t('actions.riskFlag')
                      : undefined
                }
                reasonLabel={t('actions.reason')}
                confirmLabel={t(`actions.${to}`)}
                onSubmit={(reason) => transition(to, reason)}
              />
            ),
          )}
        </div>
      )}
      {nextStatuses.includes('shipped') && (
        <ShipmentForm order={order} codToCollect={codToCollect} onShipped={() => done('shipped')} />
      )}
      {nextStatuses.includes('cancelled') ? (
        <CancelDialog order={order} amountPaid={amountPaid} />
      ) : (
        !canCancelPaid &&
        ['confirmed', 'processing'].includes(order.status) && (
          <p className="text-small text-taupe-600">{t('actions.cancelHint')}</p>
        )
      )}
      {nextStatuses.length === 0 && (
        <p className="text-small text-taupe-600">{t('actions.none')}</p>
      )}
    </div>
  );
}

function TransitionDialog({
  trigger,
  title,
  description,
  note,
  reasonLabel,
  confirmLabel,
  reasonRequired = false,
  destructive = false,
  reasonHint,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  note?: string;
  reasonLabel: string;
  reasonHint?: string;
  confirmLabel: string;
  reasonRequired?: boolean;
  destructive?: boolean;
  onSubmit: (reason: string | null) => Promise<boolean>;
}) {
  const tForm = useTranslations('admin.form');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const valid = !reasonRequired || reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle className="text-h3">{title}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            startTransition(async () => {
              if (await onSubmit(reason.trim() || null)) {
                setOpen(false);
                setReason('');
              }
            });
          }}
        >
          {note && <p className="text-small">{note}</p>}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-reason`}>{reasonLabel}</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              required={reasonRequired}
              aria-describedby={reasonHint ? `${id}-hint` : undefined}
            />
            {reasonHint && (
              <p id={`${id}-hint`} className="text-small text-taupe-600">
                {reasonHint}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tForm('cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'primary'}
              disabled={!valid}
              loading={pending}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ order, amountPaid }: { order: OrderRef; amountPaid: number }) {
  const t = useTranslations('admin.orders');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  return (
    <TransitionDialog
      trigger={
        <Button variant="ghost" className="text-danger w-fit">
          {t('actions.cancelled')}
        </Button>
      }
      title={t('cancel.title', { code: order.code })}
      description={t('cancel.description')}
      note={amountPaid > 0 ? t('cancel.refund', { amount: format.vnd(amountPaid) }) : undefined}
      reasonLabel={t('cancel.reason')}
      reasonHint={t('cancel.reasonHint')}
      confirmLabel={t('cancel.confirm')}
      reasonRequired
      destructive
      onSubmit={async (reason) => {
        const result = await cancelOrderAction({
          orderId: order.id,
          expectedVersion: order.version,
          reason,
        });
        if (!result.ok) {
          feedback.fail(result);
          return false;
        }
        feedback.success(t('actions.done', { code: order.code, status: t('status.cancelled') }));
        return true;
      }}
    />
  );
}

type ShipValues = { carrier: Carrier | null; trackingCode: string; feeActual: number | null };

function ShipmentForm({
  order,
  codToCollect,
  onShipped,
}: {
  order: OrderRef;
  codToCollect: number;
  onShipped: () => void;
}) {
  const t = useTranslations('admin.orders');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const form = useForm<ShipValues>({
    defaultValues: { carrier: 'ghn', trackingCode: '', feeActual: null },
  });

  function submit(values: ShipValues) {
    startTransition(async () => {
      const result = await shipOrderAction({
        orderId: order.id,
        expectedVersion: order.version,
        ...values,
      });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      onShipped();
    });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-line-200 flex flex-col gap-4 border p-4"
    >
      <div>
        <h3 id={`${id}-title`} className="text-body font-medium">
          {t('ship.title')}
        </h3>
        <p className="text-small text-taupe-600">{t('ship.description')}</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-4">
          <SelectField<ShipValues>
            name="carrier"
            label={t('ship.carrier')}
            placeholder={tForm('choose')}
            options={CARRIERS.map((value) => ({ value, label: t(`carrier.${value}`) }))}
          />
          <TextField<ShipValues>
            name="trackingCode"
            label={t('ship.trackingCode')}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            className="font-mono"
          />
          <NumberField<ShipValues> name="feeActual" label={t('ship.feeActual')} min={0} />
          <p className="text-small">
            {codToCollect > 0
              ? t('ship.cod', { amount: format.vnd(codToCollect) })
              : t('ship.noCod')}
          </p>
          <Button type="submit" loading={pending} className="w-fit">
            {t('ship.submit')}
          </Button>
        </form>
      </Form>
    </section>
  );
}
