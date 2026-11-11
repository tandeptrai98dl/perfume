'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Confirmation for destructive actions (§8.4). With `confirmText` the user must type it
 * (e.g. the entity name) before the button enables.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmText,
  destructive = true,
  onConfirm,
}: {
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  confirmText?: string;
  destructive?: boolean;
  /** Return `false` to keep the dialog open (e.g. the action failed). */
  onConfirm: () => Promise<boolean | void>;
}) {
  const t = useTranslations('admin.confirm');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, startTransition] = useTransition();
  const matches = !confirmText || typed.trim() === confirmText.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped('');
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-white" aria-describedby={description ? `${id}-desc` : undefined}>
        <DialogHeader>
          <DialogTitle className="text-h3">{title}</DialogTitle>
          {description && <DialogDescription id={`${id}-desc`}>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches) return;
            startTransition(async () => {
              const result = await onConfirm();
              if (result !== false) {
                setOpen(false);
                setTyped('');
              }
            });
          }}
        >
          {confirmText && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-confirm`}>{t('typeToConfirm', { text: confirmText })}</Label>
              <Input
                id={`${id}-confirm`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'primary'}
              disabled={!matches}
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
