'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { cancelOrderAction } from '@/actions/account';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { useAccountError } from './form-message';

/** Customer cancellation before processing (§10.5), confirmed in a dialog. */
export function CancelOrderButton({ code }: { code: string }) {
  const t = useTranslations('customerOrder.cancel');
  const errorMessage = useAccountError();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelOrderAction({ code });
      if (result.ok) {
        setOpen(false);
        toast.success(t('done'));
        return;
      }
      toast.error(errorMessage(result.fieldErrors[0]?.code ?? result.error));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="w-full sm:w-auto">
          {t('button')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { code })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t('keep')}</Button>
          </DialogClose>
          <Button variant="danger" loading={pending} onClick={confirm}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
