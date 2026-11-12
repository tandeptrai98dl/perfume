'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { ReviewForm, type ReviewFormTarget } from './review-form';

/** Review form that turns into the "thank you, awaiting moderation" message once sent. */
export function ReviewSubmitPanel({
  target,
  defaultName,
  after,
}: {
  target: ReviewFormTarget;
  defaultName: string;
  /** Extra content under the thank-you message (e.g. a link back to the product). */
  after?: ReactNode;
}) {
  const t = useTranslations('reviews.form');
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  if (done) {
    return (
      <div role="status" className="border-success flex flex-col items-start gap-3 border p-6">
        <CheckCircle2 aria-hidden className="text-success size-8" />
        <h2 ref={heading} tabIndex={-1} className="text-h2">
          {t('thanksTitle')}
        </h2>
        <p className="text-taupe-600">{t('thanksBody')}</p>
        {after}
      </div>
    );
  }
  return (
    <ReviewForm
      target={target}
      defaultName={defaultName}
      onSubmitted={() => {
        setDone(true);
        requestAnimationFrame(() => heading.current?.focus());
      }}
    />
  );
}
