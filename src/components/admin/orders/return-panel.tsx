'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';

import {
  approveReturnAction,
  receiveReturnAction,
  rejectReturnAction,
} from '@/actions/admin/returns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AdminReturnView, ReturnStatus } from '@/server/modules/returns';

import { useActionFeedback } from '../form/action-feedback';
import { useOrderFormat } from './format';

/*
 * ReturnPanel (ADR-0017, §11.2): the customer's request (lines, reason, description) and the
 * staff steps — approve / reject (Owner/Manager), then "goods received" (restock or write-off,
 * refund queued, e-invoice adjusted, customer e-mailed).
 */

const TONES: Record<ReturnStatus, 'warning' | 'gold' | 'neutral' | 'success'> = {
  requested: 'warning',
  approved: 'gold',
  rejected: 'neutral',
  received: 'success',
};

type Props = {
  view: AdminReturnView;
  orderCode: string;
  /** Approve / reject and reimburse return shipping (`payments.refund`). */
  canManage: boolean;
  /** Record the parcel (`orders.process`). */
  canProcess: boolean;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function ReturnPanel({ view, orderCode, canManage, canProcess }: Props) {
  const t = useTranslations('admin.returns');
  const format = useOrderFormat();
  const open = view.status === 'requested' || view.status === 'approved';
  const estimate = view.estimate;

  return (
    <div className="flex flex-col gap-4" data-testid="return-panel" data-status={view.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TONES[view.status]}>{t(`status.${view.status}`)}</Badge>
        <span className="text-small text-taupe-600">
          {t('panel.requestedAt', { date: format.dateTime(view.requestedAt) })}
        </span>
      </div>

      <dl className="text-small flex flex-col gap-1">
        <Row label={t('panel.reason')}>{t(`reasons.${view.reason}`)}</Row>
        <Row label={t('panel.resolution')}>{t(`resolutions.${view.resolution}`)}</Row>
      </dl>
      {view.openedBy === 'staff' && <p className="text-small">{t('panel.openedByStaff')}</p>}
      {view.windowOverride && (
        <p className="text-small text-warning">
          {t('panel.windowOverride', { reason: view.windowOverride.reason })}
        </p>
      )}
      {view.sealIntact && <p className="text-small">{t('panel.seal')}</p>}
      <div className="text-small flex flex-col gap-1">
        <p className="font-medium">{t('panel.description')}</p>
        <p className="whitespace-pre-line">{view.description ?? t('panel.noDescription')}</p>
      </div>
      {view.photos.length > 0 && (
        <div className="text-small flex flex-col gap-2">
          <p className="font-medium">{t('panel.photos', { count: view.photos.length })}</p>
          <ul className="flex flex-wrap gap-3">
            {view.photos.map((photo, index) => (
              <li key={photo.id}>
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-line-200 focus-visible:outline-gold-700 block border focus-visible:outline-2"
                >
                  {/* Private, staff-only bytes: not optimised or cached by next/image. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={t('panel.photoAlt', { index: index + 1, code: orderCode })}
                    width={photo.width}
                    height={photo.height}
                    loading="lazy"
                    className="h-28 w-28 object-cover"
                    data-testid="return-photo"
                  />
                </a>
              </li>
            ))}
          </ul>
          <p className="text-taupe-600">{t('panel.photosHint')}</p>
        </div>
      )}
      <div className="text-small flex flex-col gap-1">
        <p className="font-medium">{t('panel.lines')}</p>
        <ul className="flex flex-col gap-1">
          {view.items.map((item) => (
            <li key={item.orderItemId}>
              {t('panel.line', {
                name: `${item.productName} ${item.variantLabel}`.trim(),
                sku: item.sku,
                quantity: item.quantity,
                bought: item.bought,
              })}
            </li>
          ))}
        </ul>
      </div>

      {view.status !== 'received' && view.resolution === 'refund' && (
        <div className="text-small border-line-200 flex flex-col gap-1 border-t pt-3">
          <p className="font-medium">{t('panel.estimate')}</p>
          <dl className="flex flex-col gap-1">
            <Row label={t('panel.merchandise')}>{format.vnd(estimate.merchandise)}</Row>
            {estimate.shipping > 0 && (
              <Row label={t('panel.shipping')}>{format.vnd(estimate.shipping)}</Row>
            )}
            {estimate.giftWrap > 0 && (
              <Row label={t('panel.giftWrap')}>{format.vnd(estimate.giftWrap)}</Row>
            )}
            <Row label={t('panel.total')}>{format.vnd(estimate.total)}</Row>
          </dl>
        </div>
      )}
      {open && view.resolution === 'refund' && (
        <p className="text-small text-taupe-600">
          {t('panel.refundable', { amount: format.vnd(view.refundable) })}
          {view.refundable < estimate.total ? ` ${t('panel.shortfallHint')}` : ''}
        </p>
      )}

      {view.approvedAt && (
        <p className="text-small">
          {t('panel.approvedAt', { date: format.dateTime(view.approvedAt) })}
          {view.approvalNote ? ` · ${t('panel.approvalNote', { note: view.approvalNote })}` : ''}
        </p>
      )}
      {view.rejectedAt && (
        <p className="text-small">
          {t('panel.rejectedAt', { date: format.dateTime(view.rejectedAt) })} ·{' '}
          {t('panel.rejectionReason', { reason: view.rejectionReason ?? '' })}
        </p>
      )}
      {view.receivedAt && (
        <div className="text-small flex flex-col gap-1">
          <p>{t('panel.receivedAt', { date: format.dateTime(view.receivedAt) })}</p>
          {view.outcome && (
            <p>
              {t('panel.outcome')}: {t(`outcomes.${view.outcome}`)}
            </p>
          )}
          {view.refund && view.refund.queued > 0 && (
            <p>{t('panel.refundQueued', { amount: format.vnd(view.refund.queued) })}</p>
          )}
          {view.refund && view.refund.deferred > 0 && (
            <p className="text-warning">
              {t('panel.refundDeferred', { amount: format.vnd(view.refund.deferred) })}
            </p>
          )}
          {view.refund && view.refund.payout > 0 && (
            <p>{t('panel.refundPayout', { amount: format.vnd(view.refund.payout) })}</p>
          )}
          {view.refund && view.refund.shortfall > 0 && (
            <p className="text-warning">
              {t('panel.refundShortfall', { amount: format.vnd(view.refund.shortfall) })}
            </p>
          )}
          <p>{view.restocked ? t('panel.restocked') : t('panel.writtenOff')}</p>
        </div>
      )}

      {view.status === 'requested' &&
        (canManage ? (
          <div className="flex flex-wrap gap-2">
            <ApproveDialog view={view} orderCode={orderCode} />
            <RejectDialog view={view} orderCode={orderCode} />
          </div>
        ) : (
          <p className="text-small text-taupe-600">{t('panel.managerOnly')}</p>
        ))}
      {view.status === 'approved' && (
        <div className="flex flex-wrap gap-2">
          {canProcess && <ReceiveDialog view={view} orderCode={orderCode} canManage={canManage} />}
          {canManage && <RejectDialog view={view} orderCode={orderCode} />}
        </div>
      )}
    </div>
  );
}

export function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  canSubmit = true,
  children,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  canSubmit?: boolean;
  children: ReactNode;
  onSubmit: () => Promise<boolean>;
}) {
  const tForm = useTranslations('admin.form');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            if (!canSubmit) return;
            startTransition(async () => {
              if (await onSubmit()) setOpen(false);
            });
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tForm('cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'primary'}
              disabled={!canSubmit}
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

function ApproveDialog({ view, orderCode }: { view: AdminReturnView; orderCode: string }) {
  const t = useTranslations('admin.returns');
  const feedback = useActionFeedback();
  const id = useId();
  const [note, setNote] = useState('');
  return (
    <ActionDialog
      trigger={<Button>{t('approve.button')}</Button>}
      title={t('approve.title', { code: orderCode })}
      description={t('approve.description')}
      confirmLabel={t('approve.confirm')}
      onSubmit={async () => {
        const result = await approveReturnAction({
          orderId: view.orderId,
          requestId: view.requestId,
          note: note.trim() || null,
        });
        if (!result.ok) {
          feedback.fail(result);
          return false;
        }
        feedback.success(t('approve.done', { code: orderCode }));
        return true;
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-note`}>{t('approve.note')}</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={500}
        />
      </div>
    </ActionDialog>
  );
}

function RejectDialog({ view, orderCode }: { view: AdminReturnView; orderCode: string }) {
  const t = useTranslations('admin.returns');
  const feedback = useActionFeedback();
  const id = useId();
  const [reason, setReason] = useState('');
  return (
    <ActionDialog
      trigger={
        <Button variant="ghost" className="text-danger">
          {t('reject.button')}
        </Button>
      }
      title={t('reject.title', { code: orderCode })}
      description={t('reject.description')}
      confirmLabel={t('reject.confirm')}
      destructive
      canSubmit={reason.trim().length >= 5}
      onSubmit={async () => {
        const result = await rejectReturnAction({
          orderId: view.orderId,
          requestId: view.requestId,
          reason,
        });
        if (!result.ok) {
          feedback.fail(result);
          return false;
        }
        feedback.success(t('reject.done', { code: orderCode }));
        return true;
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-reason`}>{t('reject.reason')}</Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          required
        />
      </div>
    </ActionDialog>
  );
}

function ReceiveDialog({
  view,
  orderCode,
  canManage,
}: {
  view: AdminReturnView;
  orderCode: string;
  canManage: boolean;
}) {
  const t = useTranslations('admin.returns');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const id = useId();
  const [resellable, setResellable] = useState(view.defaultResellable);
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');
  const returnShippingFee =
    view.fault && canManage ? Math.max(0, Number.parseInt(fee, 10) || 0) : 0;
  const outcomeNote =
    view.estimate.outcome === 'replacement'
      ? t('receive.replacementNote')
      : view.estimate.outcome === 'full'
        ? t('receive.fullNote')
        : t('receive.partialNote');
  const total = view.estimate.total + (view.resolution === 'refund' ? returnShippingFee : 0);

  return (
    <ActionDialog
      trigger={<Button>{t('receive.button')}</Button>}
      title={t('receive.title', { code: orderCode })}
      description={t('receive.description')}
      confirmLabel={t('receive.confirm')}
      onSubmit={async () => {
        const result = await receiveReturnAction({
          orderId: view.orderId,
          requestId: view.requestId,
          resellable,
          returnShippingFee: view.resolution === 'refund' ? returnShippingFee : 0,
          note: note.trim() || null,
        });
        if (!result.ok) {
          feedback.fail(result);
          return false;
        }
        feedback.success(t('receive.done', { code: orderCode }));
        return true;
      }}
    >
      <p className="text-small">{outcomeNote}</p>
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${id}-resellable`}
            checked={resellable}
            onCheckedChange={(value) => setResellable(value === true)}
            aria-describedby={`${id}-resellable-hint`}
          />
          <Label htmlFor={`${id}-resellable`} className="cursor-pointer">
            {t('receive.resellable')}
          </Label>
        </div>
        <p id={`${id}-resellable-hint`} className="text-small text-taupe-600">
          {t('receive.resellableHint')}
        </p>
      </div>
      {view.fault && view.resolution === 'refund' && canManage && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-fee`}>{t('receive.returnShippingFee')}</Label>
          <Input
            id={`${id}-fee`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            aria-describedby={`${id}-fee-hint`}
          />
          <p id={`${id}-fee-hint`} className="text-small text-taupe-600">
            {t('receive.returnShippingHint')}
          </p>
        </div>
      )}
      {view.resolution === 'refund' && (
        <p className="text-small font-medium">
          {t('panel.total')}: {format.vnd(total)}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-note`}>{t('receive.note')}</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
        />
      </div>
    </ActionDialog>
  );
}
