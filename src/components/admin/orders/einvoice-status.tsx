'use client';

import { ExternalLink, FilePen, FileText, FileX, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  cancelEinvoiceAction,
  replaceEinvoiceAction,
  retryEinvoiceAction,
} from '@/actions/admin/einvoices';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  EinvoiceAdjustmentAction,
  EinvoiceState,
  OrderEinvoiceView,
} from '@/server/modules/einvoice';

import { useActionFeedback } from '../form/action-feedback';
import { useOrderFormat } from './format';

/*
 * EInvoiceStatus (§8.4, D13): state of the order's automatic e-invoice, "View" for an issued
 * invoice (number, series, provider lookup) and "Retry" for a failed one (orders.process).
 */

const TONES: Record<EinvoiceState, 'neutral' | 'outline' | 'success' | 'warning' | 'gold'> = {
  not_applicable: 'outline',
  pending: 'neutral',
  retrying: 'gold',
  issued: 'success',
  failed: 'warning',
};

export function useEinvoiceReason() {
  const t = useTranslations('admin.einvoices.reasons');
  return (reason: string | null) => {
    if (!reason) return '—';
    const key = reason as 'unexpected';
    return t.has(key) ? t(key) : reason;
  };
}

export function EinvoiceReason({ reason }: { reason: string | null }) {
  return <>{useEinvoiceReason()(reason)}</>;
}

export function EinvoiceRetryButton({
  orderId,
  label,
  size = 'sm',
}: {
  orderId: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('admin.einvoices');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      loading={pending}
      aria-label={label}
      className="w-fit"
      onClick={() =>
        startTransition(async () => {
          const result = await retryEinvoiceAction({ orderId });
          if (!result.ok) {
            feedback.fail(result);
            return;
          }
          feedback.success(t('retryDone'));
        })
      }
    >
      <RotateCcw aria-hidden />
      {t('retry')}
    </Button>
  );
}

/** "Huỷ hoá đơn" / "Lập hoá đơn thay thế" with a confirmation and a required reason. */
function EinvoiceAdjustButton({
  orderId,
  invoiceRef,
  action,
}: {
  orderId: string;
  invoiceRef: string;
  action: EinvoiceAdjustmentAction;
}) {
  const t = useTranslations('admin.einvoices.adjust');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const cancel = action === 'cancel';
  const valid = reason.trim().length >= 5;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="w-fit">
          {cancel ? <FileX aria-hidden /> : <FilePen aria-hidden />}
          {cancel ? t('cancel') : t('replace')}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>
            {cancel
              ? t('cancelTitle', { number: invoiceRef })
              : t('replaceTitle', { number: invoiceRef })}
          </DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            {cancel ? t('cancelDescription') : t('replaceDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            startTransition(async () => {
              const run = cancel ? cancelEinvoiceAction : replaceEinvoiceAction;
              const result = await run({ orderId, reason: reason.trim() });
              if (!result.ok) {
                feedback.fail(result);
                return;
              }
              feedback.success(cancel ? t('cancelDone') : t('replaceDone'));
              setOpen(false);
              setReason('');
            });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={300}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tForm('cancel')}
            </Button>
            <Button
              type="submit"
              variant={cancel ? 'danger' : 'primary'}
              disabled={!valid}
              loading={pending}
            >
              {cancel ? t('confirmCancel') : t('confirmReplace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentState({ einvoice }: { einvoice: OrderEinvoiceView }) {
  const t = useTranslations('admin.einvoices.adjust');
  const reason = useEinvoiceReason();
  const adjustment = einvoice.adjustment;
  if (adjustment.state === 'none') return null;
  const action = adjustment.action ? t(`actions.${adjustment.action}`) : '';
  return (
    <p className="text-small" data-testid="einvoice-adjustment" data-state={adjustment.state}>
      {t(`state.${adjustment.state}`, {
        action,
        attempts: adjustment.attempts,
        reason: reason(adjustment.reason),
      })}
    </p>
  );
}

export function EinvoiceStatus({
  einvoice,
  orderCode,
  canProcess,
  canAdjust = false,
}: {
  einvoice: OrderEinvoiceView;
  orderCode: string;
  /** Staff may retry (`orders.process`); the state decides whether a retry is offered. */
  canProcess: boolean;
  /** Cancel / replace the issued invoice (`payments.refund`, Owner/Manager). */
  canAdjust?: boolean;
}) {
  const t = useTranslations('admin.einvoices');
  const format = useOrderFormat();
  const reason = useEinvoiceReason();
  const invoice = einvoice.invoice;
  const values = { attempts: einvoice.attempts, reason: reason(einvoice.reason) };
  const adjustment = einvoice.adjustment;
  const badge =
    adjustment.state === 'cancelled' || adjustment.state === 'replaced'
      ? t(`adjust.badge.${adjustment.state}`)
      : t(`panel.badge.${einvoice.state}`);

  return (
    <div className="flex flex-col gap-3" data-testid="einvoice-status" data-state={einvoice.state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium">{t('panel.title')}</h3>
        <Badge variant={adjustment.state === 'cancelled' ? 'neutral' : TONES[einvoice.state]}>
          {badge}
        </Badge>
      </div>
      <p className="text-small">{t(`panel.state.${einvoice.state}`, values)}</p>
      <AdjustmentState einvoice={einvoice} />
      {invoice && (
        <dl className="text-small flex flex-col gap-1">
          <div className="flex justify-between gap-4">
            <dt>{t('details.invoiceNo')}</dt>
            <dd className="font-mono">{invoice.ref}</dd>
          </div>
          {invoice.issuedAt && (
            <div className="flex justify-between gap-4">
              <dt>{t('details.issuedAt')}</dt>
              <dd className="tabular-nums">{format.dateTime(invoice.issuedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-small text-taupe-600">
        {(invoice?.buyer ?? (einvoice.company ? 'company' : 'individual')) === 'company'
          ? t('panel.buyerCompany')
          : t('panel.buyerIndividual')}
      </p>
      {invoice && (
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="w-fit">
              <FileText aria-hidden />
              {t('view')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('details.title', { number: invoice.ref })}</DialogTitle>
              <DialogDescription>{t('details.description', { code: orderCode })}</DialogDescription>
            </DialogHeader>
            <dl className="text-small flex flex-col gap-2">
              {(
                [
                  ['invoiceNo', invoice.invoiceNo],
                  ['series', invoice.series],
                  ['template', invoice.templateCode],
                  ['issuedAt', invoice.issuedAt ? format.dateTime(invoice.issuedAt) : null],
                  [
                    'provider',
                    invoice.provider ? t(`providers.${invoice.provider as 'misa'}`) : null,
                  ],
                  ['transactionId', invoice.transactionId],
                  ['lookupCode', invoice.lookupCode],
                ] as const
              )
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt>{t(`details.${key}`)}</dt>
                    <dd className="font-mono break-all">{value}</dd>
                  </div>
                ))}
            </dl>
            {invoice.provider === 'sandbox' && (
              <p className="text-small text-warning">{t('details.sandbox')}</p>
            )}
            <DialogFooter>
              {invoice.lookupUrl && (
                <Button asChild variant="secondary">
                  <a href={invoice.lookupUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden />
                    {t('details.lookup')}
                  </a>
                </Button>
              )}
              <DialogClose asChild>
                <Button type="button">{t('details.close')}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canAdjust && invoice && adjustment.canAdjust && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <EinvoiceAdjustButton
              orderId={einvoice.orderId}
              invoiceRef={invoice.ref}
              action="cancel"
            />
            <EinvoiceAdjustButton
              orderId={einvoice.orderId}
              invoiceRef={invoice.ref}
              action="replace"
            />
          </div>
          <p className="text-small text-taupe-600">{t('adjust.hint')}</p>
        </div>
      )}
      {canProcess && einvoice.canRetry && (
        <div className="flex flex-col gap-1">
          <EinvoiceRetryButton
            orderId={einvoice.orderId}
            label={t('retryNamed', { code: orderCode })}
          />
          <p className="text-small text-taupe-600">{t('panel.retryHint')}</p>
        </div>
      )}
    </div>
  );
}
