'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';

import {
  anonymizePrivacySubjectAction,
  rerunPrivacyExportAction,
  setPrivacyRequestStatusAction,
} from '@/actions/admin/privacy';
import type { ActionResult } from '@/actions/admin/run';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import { PRIVACY_STATUS_TONES, privacyStatusKey, privacyTypeKey } from './labels';

type Status = 'received' | 'in_progress' | 'completed' | 'rejected';

export type PrivacyRequestDetailData = {
  id: string;
  type: 'export' | 'delete' | 'correct' | 'withdraw_consent';
  status: Status;
  email: string;
  note: string | null;
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
  overdue: boolean;
  account: { name: string; role: string; deleted: boolean } | null;
  openOrders: number;
  history: { action: string; actorName: string | null; createdAt: string }[];
};

const DATE_TIME = { dateStyle: 'medium', timeStyle: 'short' } as const;
const KNOWN_ACTIONS = [
  'privacy_request.created',
  'privacy_request.in_progress',
  'privacy_request.completed',
  'privacy_request.rejected',
  'privacy_request.export_sent',
  'privacy_request.anonymized',
] as const;

/** Request detail (§11.2): subject summary, the actions its type and status allow, history. */
export function PrivacyRequestDetailView({ request }: { request: PrivacyRequestDetailData }) {
  const t = useTranslations('admin.privacyRequests');
  const format = useFormatter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const open = request.status === 'received' || request.status === 'in_progress';

  async function run(action: () => Promise<ActionResult<unknown>>, done: string) {
    const result = await action();
    if (!result.ok) {
      feedback.fail(result);
      return false;
    }
    feedback.success(done);
    return true;
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="request-summary" className="border-line-200 border bg-white p-6">
          <h2 id="request-summary" className="text-h3 mb-4">
            {t('detail.summary')}
          </h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-3">
            <dt className="text-taupe-600">{t('columns.type')}</dt>
            <dd>{t(`types.${privacyTypeKey(request.type)}`)}</dd>
            <dt className="text-taupe-600">{t('columns.status')}</dt>
            <dd className="flex items-center gap-2">
              <Badge variant={PRIVACY_STATUS_TONES[request.status]}>
                {t(`status.${privacyStatusKey(request.status)}`)}
              </Badge>
              {request.overdue && <Badge variant="warning">{t('overdue')}</Badge>}
            </dd>
            <dt className="text-taupe-600">{t('columns.email')}</dt>
            <dd className="break-all">{request.email}</dd>
            <dt className="text-taupe-600">{t('detail.account')}</dt>
            <dd>
              {request.account
                ? request.account.deleted
                  ? t('detail.accountDeleted')
                  : `${request.account.name} · ${t(`detail.roles.${request.account.role === 'customer' ? 'customer' : 'staff'}`)}`
                : t('account.guest')}
            </dd>
            <dt className="text-taupe-600">{t('columns.createdAt')}</dt>
            <dd className="tabular-nums">
              {format.dateTime(new Date(request.createdAt), DATE_TIME)}
            </dd>
            <dt className="text-taupe-600">{t('columns.dueAt')}</dt>
            <dd className="tabular-nums">{format.dateTime(new Date(request.dueAt), DATE_TIME)}</dd>
            {request.completedAt && (
              <>
                <dt className="text-taupe-600">{t('detail.completedAt')}</dt>
                <dd className="tabular-nums">
                  {format.dateTime(new Date(request.completedAt), DATE_TIME)}
                </dd>
              </>
            )}
            <dt className="text-taupe-600">{t('detail.openOrders')}</dt>
            <dd className="tabular-nums">{request.openOrders}</dd>
          </dl>
          {request.note && (
            <div className="border-line-200 mt-6 border-t pt-4">
              <h3 className="text-small mb-2 font-medium">{t('detail.note')}</h3>
              <p className="whitespace-pre-line">{request.note}</p>
            </div>
          )}
        </section>

        <section aria-labelledby="request-history" className="border-line-200 border bg-white p-6">
          <h2 id="request-history" className="text-h3 mb-4">
            {t('detail.history')}
          </h2>
          <ol className="flex flex-col gap-3">
            {request.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="flex flex-col">
                <span>
                  {(KNOWN_ACTIONS as readonly string[]).includes(entry.action)
                    ? t(`actions.${entry.action.slice('privacy_request.'.length) as 'created'}`)
                    : entry.action}
                </span>
                <span className="text-small text-taupe-600">
                  {format.dateTime(new Date(entry.createdAt), DATE_TIME)} ·{' '}
                  {entry.actorName ?? t('detail.requester')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside aria-labelledby="request-actions" className="flex flex-col gap-4">
        <h2 id="request-actions" className="text-h3">
          {t('detail.actions')}
        </h2>
        {!open && request.type !== 'export' && (
          <p className="text-small text-taupe-600">{t('detail.closed')}</p>
        )}
        {request.status === 'received' && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await run(
                  () => setPrivacyRequestStatusAction({ id: request.id, status: 'in_progress' }),
                  t('done.inProgress'),
                );
              })
            }
          >
            {t('start')}
          </Button>
        )}
        {request.type === 'export' && request.status !== 'rejected' && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await run(() => rerunPrivacyExportAction({ id: request.id }), t('done.exportSent'));
              })
            }
          >
            {t('rerunExport')}
          </Button>
        )}
        {request.type === 'delete' && open && (
          <>
            {request.openOrders > 0 && (
              <p className="text-small text-warning" role="note">
                {t('detail.openOrdersBlock', { count: request.openOrders })}
              </p>
            )}
            <ConfirmDialog
              trigger={
                <Button variant="danger" disabled={pending || request.openOrders > 0}>
                  {t('anonymize.open')}
                </Button>
              }
              title={t('anonymize.title')}
              description={t('anonymize.description')}
              confirmLabel={t('anonymize.confirm')}
              confirmText={request.email}
              onConfirm={() =>
                run(
                  () =>
                    anonymizePrivacySubjectAction({ id: request.id, confirmEmail: request.email }),
                  t('done.anonymized'),
                )
              }
            />
          </>
        )}
        {open && request.type !== 'delete' && request.type !== 'export' && (
          <NoteDialog
            trigger={<Button disabled={pending}>{t('complete.open')}</Button>}
            title={t('complete.title')}
            description={t('complete.description')}
            label={t('complete.note')}
            submitLabel={t('complete.submit')}
            onSubmit={(note) =>
              run(
                () => setPrivacyRequestStatusAction({ id: request.id, status: 'completed', note }),
                t('done.completed'),
              )
            }
          />
        )}
        {open && (
          <NoteDialog
            trigger={
              <Button variant="ghost" disabled={pending}>
                {t('reject.open')}
              </Button>
            }
            title={t('reject.title')}
            description={t('reject.description')}
            label={t('reject.note')}
            submitLabel={t('reject.submit')}
            required
            onSubmit={(note) =>
              run(
                () => setPrivacyRequestStatusAction({ id: request.id, status: 'rejected', note }),
                t('done.rejected'),
              )
            }
          />
        )}
      </aside>
    </div>
  );
}

function NoteDialog({
  trigger,
  title,
  description,
  label,
  submitLabel,
  required = false,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  required?: boolean;
  onSubmit: (note: string) => Promise<boolean>;
}) {
  const id = useId();
  const tConfirm = useTranslations('admin.confirm');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNote('');
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (required && !note.trim()) return;
            startTransition(async () => {
              if (await onSubmit(note)) setOpen(false);
            });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-note`}>{label}</Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={1000}
              required={required}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tConfirm('cancel')}
            </Button>
            <Button type="submit" loading={pending} disabled={required && !note.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
