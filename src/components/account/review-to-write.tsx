'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ReviewForm } from '@/components/shop/reviews/review-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** "Write a review" for one purchased line (account → Reviews); the form opens in a dialog. */
export function ReviewToWrite({
  orderItemId,
  productName,
  variantLabel,
  defaultName,
}: {
  orderItemId: string;
  productName: string;
  variantLabel: string;
  defaultName: string;
}) {
  const t = useTranslations('reviews.account');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="write-review">
          {t('write')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-h3 pr-10">
            {t('dialogTitle', { product: productName })}
          </DialogTitle>
          <DialogDescription>{variantLabel}</DialogDescription>
        </DialogHeader>
        <ReviewForm
          target={{ kind: 'member', orderItemId }}
          defaultName={defaultName}
          onSubmitted={() => {
            setOpen(false);
            toast.success(t('submitted'));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
