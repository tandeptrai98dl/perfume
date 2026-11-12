'use client';

import { ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { retryEinvoiceAction } from '@/actions/admin/einvoices';
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
import type { EinvoiceState, OrderEinvoiceView } from '@/server/modules/einvoice';

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

export function EinvoiceStatus({
  einvoice,
  orderCode,
  canProcess,
}: {
  einvoice: OrderEinvoiceView;
  orderCode: string;
  /** Staff may retry (`orders.process`); the state decides whether a retry is offered. */
  canProcess: boolean;
}) {
  const t = useTranslations('admin.einvoices');
  const format = useOrderFormat();
  const reason = useEinvoiceReason();
  const invoice = einvoice.invoice;
  const values = { attempts: einvoice.attempts, reason: reason(einvoice.reason) };

  return (
    <div className="flex flex-col gap-3" data-testid="einvoice-status" data-state={einvoice.state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium">{t('panel.title')}</h3>
        <Badge variant={TONES[einvoice.state]}>{t(`panel.badge.${einvoice.state}`)}</Badge>
      </div>
      <p className="text-small">{t(`panel.state.${einvoice.state}`, values)}</p>
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
