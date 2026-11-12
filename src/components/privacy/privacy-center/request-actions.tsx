'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { requestAccountPrivacyAction } from '@/actions/privacy';
import { FormNotice } from '@/components/account/form-message';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { usePrivacyError } from './errors';

type RequestType = 'export' | 'delete' | 'correct' | 'withdraw_consent';

/** Export, correction and deletion requests from the privacy centre (one open per type). */
export function RequestActions({ openTypes }: { openTypes: RequestType[] }) {
  const t = useTranslations('privacyCenter.requests');
  const format = useFormatter();
  const errorMessage = usePrivacyError();
  const locale = useLocale() as 'vi' | 'en';
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [correction, setCorrection] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function submit(
    values:
      | { type: 'export' }
      | { type: 'correct'; details: string }
      | { type: 'delete'; details?: string },
    onDone?: () => void,
    onError?: (message: string) => void,
  ) {
    startTransition(async () => {
      const result = await requestAccountPrivacyAction({ ...values, locale });
      if (!result.ok) {
        const field = result.fieldErrors[0]?.code;
        const message = errorMessage(
          result.error === 'validation' ? field : (field ?? result.error),
        );
        if (onError) onError(message);
        else toast.error(message);
        return;
      }
      const due = format.dateTime(new Date(result.data.dueAt), { dateStyle: 'long' });
      toast.success(
        result.data.created ? t(`sent.${values.type}`, { date: due }) : t('alreadyOpen'),
      );
      onDone?.();
    });
  }

  const busy = (type: RequestType) => pending || openTypes.includes(type);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
      <div className="border-line-200 flex flex-col gap-3 border p-5">
        <h3 className="text-h3">{t('export.title')}</h3>
        <p className="text-small text-taupe-600">{t('export.description')}</p>
        <Button
          variant="secondary"
          className="mt-auto self-start"
          disabled={busy('export')}
          onClick={() => submit({ type: 'export' })}
        >
          {t('export.action')}
        </Button>
        {openTypes.includes('export') && (
          <p className="text-small text-taupe-600">{t('pendingNote')}</p>
        )}
      </div>

      <form
        className="border-line-200 flex flex-col gap-3 border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setCorrectionError(null);
          submit(
            { type: 'correct', details: correction },
            () => setCorrection(''),
            setCorrectionError,
          );
        }}
      >
        <h3 className="text-h3">{t('correct.title')}</h3>
        <p className="text-small text-taupe-600">{t('correct.description')}</p>
        <Label htmlFor={`${id}-correct`}>{t('correct.label')}</Label>
        <Textarea
          id={`${id}-correct`}
          value={correction}
          maxLength={1000}
          onChange={(event) => setCorrection(event.target.value)}
          aria-invalid={!!correctionError}
          aria-describedby={correctionError ? `${id}-correct-error` : undefined}
        />
        {correctionError && (
          <p id={`${id}-correct-error`} role="alert" className="text-small text-danger">
            {correctionError}
          </p>
        )}
        <Button type="submit" variant="secondary" className="self-start" disabled={busy('correct')}>
          {t('correct.action')}
        </Button>
        {openTypes.includes('correct') && (
          <p className="text-small text-taupe-600">{t('pendingNote')}</p>
        )}
      </form>

      <div className="border-line-200 flex flex-col gap-3 border p-5">
        <h3 className="text-h3">{t('delete.title')}</h3>
        <p className="text-small text-taupe-600">{t('delete.description')}</p>
        <Dialog
          open={deleteOpen}
          onOpenChange={(next) => {
            setDeleteOpen(next);
            if (!next) {
              setUnderstood(false);
              setDeleteError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="secondary" className="mt-auto self-start" disabled={busy('delete')}>
              {t('delete.action')}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="text-h3">{t('delete.confirmTitle')}</DialogTitle>
              <DialogDescription>{t('delete.confirmDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!understood) return;
                setDeleteError(null);
                submit(
                  { type: 'delete', details: reason },
                  () => {
                    setDeleteOpen(false);
                    setReason('');
                    setUnderstood(false);
                  },
                  setDeleteError,
                );
              }}
            >
              {deleteError && <FormNotice tone="error">{deleteError}</FormNotice>}
              <ul className="text-small list-disc pl-5 text-taupe-600">
                <li>{t('delete.consequences.account')}</li>
                <li>{t('delete.consequences.orders')}</li>
                <li>{t('delete.consequences.openOrders')}</li>
              </ul>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-reason`}>{t('delete.reason')}</Label>
                <Textarea
                  id={`${id}-reason`}
                  rows={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`${id}-understood`}
                  checked={understood}
                  onCheckedChange={(checked) => setUnderstood(checked === true)}
                  className="mt-3"
                />
                <Label htmlFor={`${id}-understood`} className="min-h-11 content-center">
                  {t('delete.understood')}
                </Label>
              </div>
              <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
                  {t('delete.cancel')}
                </Button>
                <Button type="submit" variant="danger" disabled={!understood} loading={pending}>
                  {t('delete.submit')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        {openTypes.includes('delete') && (
          <p className="text-small text-taupe-600">{t('pendingNote')}</p>
        )}
      </div>
    </div>
  );
}
