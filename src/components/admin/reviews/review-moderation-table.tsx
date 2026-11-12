'use client';

import { BadgeCheck, MessageSquareReply } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, useTransition } from 'react';

import { moderateReviewAction, replyReviewAction } from '@/actions/admin/reviews';
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
import { RatingDisplay } from '@/components/ui/rating';
import { Textarea } from '@/components/ui/textarea';
import type { ModerationRow, ReviewStatus } from '@/server/modules/review';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { useActionFeedback } from '../form/action-feedback';
import { useOrderFormat } from '../orders/format';

const REPLY_MAX = 1000;

const STATUS_TONES: Record<ReviewStatus, 'gold' | 'success' | 'outline'> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'outline',
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const t = useTranslations('admin.reviews.status');
  return (
    <Badge variant={STATUS_TONES[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}

function ReplyDialog({ review }: { review: ModerationRow }) {
  const t = useTranslations('admin.reviews');
  const feedback = useActionFeedback();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.adminReply ?? '');
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await replyReviewAction({ id: review.id, reply: text });
      if (!result.ok) return feedback.fail(result);
      feedback.success(t(result.data.adminReply ? 'replySaved' : 'replyRemoved'));
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setText(review.adminReply ?? '');
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('replyFor', { name: review.reviewerName })}>
          <MessageSquareReply aria-hidden />
          {review.adminReply ? t('editReply') : t('reply')}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('replyTitle')}</DialogTitle>
          <DialogDescription>{t('replyHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-reply`}>{t('replyLabel')}</Label>
            <Textarea
              id={`${id}-reply`}
              rows={5}
              maxLength={REPLY_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="text-small text-taupe-600">
              {t('replyCount', { count: text.length, max: REPLY_MAX })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {t('saveReply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve / reject / reply (ReviewModerationCard actions, §8.4). */
function ModerationActions({ review }: { review: ModerationRow }) {
  const t = useTranslations('admin.reviews');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();

  function decide(decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const result = await moderateReviewAction({ id: review.id, decision });
      if (!result.ok) return feedback.fail(result);
      feedback.success(t(decision === 'approved' ? 'approvedToast' : 'rejectedToast'));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {review.status !== 'approved' && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => decide('approved')}
          aria-label={t('approveFor', { name: review.reviewerName })}
        >
          {t('approve')}
        </Button>
      )}
      {review.status !== 'rejected' && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => decide('rejected')}
          aria-label={t('rejectFor', { name: review.reviewerName })}
        >
          {review.status === 'approved' ? t('unpublish') : t('reject')}
        </Button>
      )}
      <ReplyDialog review={review} />
    </div>
  );
}

/** Moderation queue (§5.2 /admin/reviews): status tabs on the page, search, pagination. */
export function ReviewModerationTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: ModerationRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.reviews');
  const format = useOrderFormat();
  const columns = useMemo<DataTableColumn<ModerationRow>[]>(
    () => [
      {
        id: 'review',
        header: t('columns.review'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex max-w-xl flex-col gap-2" data-testid="moderation-review">
              <div className="flex flex-wrap items-center gap-3">
                <RatingDisplay value={r.rating} />
                <span className="text-small text-taupe-600">
                  {t('language', { locale: t(`locales.${r.locale}`) })}
                </span>
              </div>
              {r.title && <p className="font-medium wrap-anywhere">{r.title}</p>}
              <p
                lang={r.locale}
                className="text-small text-ink-700 wrap-anywhere whitespace-pre-line"
              >
                {r.body}
              </p>
              {(r.longevity !== null || r.sillage !== null) && (
                <p className="text-small text-taupe-600">
                  {t('scores', {
                    longevity: r.longevity ?? '—',
                    sillage: r.sillage ?? '—',
                  })}
                </p>
              )}
              {r.adminReply && (
                <div className="bg-sand-100 text-small p-3">
                  <p className="font-medium">{t('currentReply')}</p>
                  <p className="wrap-anywhere whitespace-pre-line">{r.adminReply}</p>
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'product',
        header: t('columns.product'),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium wrap-anywhere">{row.original.productName}</span>
            <span className="text-small text-taupe-600">{row.original.variantLabel}</span>
            <span className="text-small font-mono">{row.original.orderCode}</span>
          </div>
        ),
      },
      {
        id: 'reviewer',
        header: t('columns.reviewer'),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="wrap-anywhere">{row.original.reviewerName}</span>
            <span className="text-small inline-flex items-center gap-1 text-taupe-600">
              <BadgeCheck aria-hidden className="size-4" />
              {row.original.isMember ? t('member') : t('guest')}
            </span>
          </div>
        ),
      },
      {
        id: 'createdAt',
        header: t('columns.createdAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.dateTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <ReviewStatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: t('columns.actions'),
        cell: ({ row }) => <ModerationActions review={row.original} />,
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('title')}
      sortable={{ createdAt: 'createdAt', review: 'rating' }}
      searchLabel={t('search')}
      emptyTitle={t('empty')}
    />
  );
}
