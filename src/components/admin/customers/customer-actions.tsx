'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { addCustomerNoteAction, setCustomerCodRiskAction } from '@/actions/admin/customers';
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

import { useActionFeedback } from '../form/action-feedback';

const REASON_MIN = 5;
const REASON_MAX = 500;
const NOTE_MAX = 1000;

/**
 * COD risk flag of an account (D16): set or clear it with a reason (audited). The phone's
 * failed-delivery history stays a warning on later COD orders either way.
 */
export function CodRiskControl({
  userId,
  flagged,
  name,
}: {
  userId: string;
  flagged: boolean;
  name: string;
}) {
  const t = useTranslations('admin.customers.riskControl');
  const tConfirm = useTranslations('admin.confirm');
  const feedback = useActionFeedback();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length >= REASON_MIN;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}
    >
      <DialogTrigger asChild>
        <Button variant={flagged ? 'secondary' : 'danger'} className="w-fit">
          {flagged ? t('clear') : t('set')}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">
            {flagged ? t('clearTitle', { name }) : t('setTitle', { name })}
          </DialogTitle>
          <DialogDescription>
            {flagged ? t('clearDescription') : t('setDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            startTransition(async () => {
              const result = await setCustomerCodRiskAction({
                userId,
                flagged: !flagged,
                reason,
              });
              if (!result.ok) {
                feedback.fail(result);
                return;
              }
              feedback.success(flagged ? t('cleared') : t('flaggedDone'));
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
              minLength={REASON_MIN}
              maxLength={REASON_MAX}
              required
              aria-describedby={`${id}-hint`}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={`${id}-hint`} className="text-small text-taupe-600">
              {t('reasonHint', { min: REASON_MIN })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tConfirm('cancel')}
            </Button>
            <Button
              type="submit"
              variant={flagged ? 'primary' : 'danger'}
              loading={pending}
              disabled={!valid}
            >
              {flagged ? t('clear') : t('set')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Internal note on a customer account (staff only, append-only, audited). */
export function CustomerNoteForm({ userId }: { userId: string }) {
  const t = useTranslations('admin.customers.notes');
  const feedback = useActionFeedback();
  const id = useId();
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!note.trim()) return;
        startTransition(async () => {
          const result = await addCustomerNoteAction({ userId, note });
          if (!result.ok) {
            feedback.fail(result);
            return;
          }
          feedback.success(t('done'));
          setNote('');
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-note`}>{t('label')}</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setNote(event.target.value)}
        />
        <p id={`${id}-hint`} className="text-small text-taupe-600">
          {t('hint')}
        </p>
      </div>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        disabled={!note.trim()}
        className="w-fit"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
