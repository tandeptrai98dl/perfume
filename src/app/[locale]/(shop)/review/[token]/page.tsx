import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ReviewSubmitPanel } from '@/components/shop/reviews/review-submit-panel';
import { Link } from '@/i18n/navigation';
import { REVIEW_TOKEN_PATTERN } from '@/lib/validation/review';
import { getDb } from '@/server/db/client';
import {
  getInvitationByToken,
  type InvitationState,
  type InvitationView,
} from '@/server/modules/review';

import { resolveLocale } from '../../_content/shared';
import { AccountSkeleton } from '../../account/_lib/account-page';

type Props = PageProps<'/[locale]/review/[token]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'reviews.link' });
  // One-time links: never indexed, never followed (ADR-0008; robots.txt also blocks them).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Guest review through the e-mailed one-time link (ADR-0008): `/danh-gia/[token]`,
 * `/en/review/[token]`. The token is checked on render and again on submit.
 */
export default function ReviewLinkPage({ params }: Props) {
  return (
    <div className="container-content max-w-3xl py-10 lg:py-16">
      <Suspense fallback={<AccountSkeleton />}>
        <ReviewLink params={params} />
      </Suspense>
    </div>
  );
}

async function ReviewLink({ params }: { params: Props['params'] }) {
  const locale = await resolveLocale(params);
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const t = await getTranslations({ locale, namespace: 'reviews.link' });
  const invitation = REVIEW_TOKEN_PATTERN.test(token)
    ? await getInvitationByToken(getDb(), { token, locale })
    : null;

  if (!invitation || invitation.state !== 'valid') {
    const state: Exclude<InvitationState, 'valid'> | 'notFound' =
      invitation && invitation.state !== 'valid' ? invitation.state : 'notFound';
    return (
      <div className="flex flex-col items-start gap-4" data-testid="review-link-state">
        <h1 className="text-h1">{t(`states.${state}.title`)}</h1>
        <p className="text-taupe-600">{t(`states.${state}.body`)}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {invitation && <ProductLink invitation={invitation} label={t('viewProduct')} />}
          <Link
            href="/account/reviews"
            className="text-gold-700 inline-flex min-h-11 items-center hover:underline"
          >
            {t('account')}
          </Link>
          <Link
            href="/contact"
            className="text-gold-700 inline-flex min-h-11 items-center hover:underline"
          >
            {t('contact')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="eyebrow text-gold-700">{t('eyebrow', { code: invitation.orderCode })}</p>
        <h1 className="text-h1">{t('title', { product: invitation.productName })}</h1>
        <p className="text-taupe-600">{t('intro', { variant: invitation.variantLabel })}</p>
      </header>
      <ReviewSubmitPanel
        target={{ kind: 'guest', token }}
        defaultName={invitation.suggestedName}
        after={<ProductLink invitation={invitation} label={t('viewProduct')} />}
      />
    </div>
  );
}

function ProductLink({ invitation, label }: { invitation: InvitationView; label: string }) {
  if (!invitation.productSlug) return null;
  return (
    <Link
      href={{ pathname: '/products/[slug]', params: { slug: invitation.productSlug } }}
      className="text-gold-700 inline-flex min-h-11 items-center hover:underline"
    >
      {label}
    </Link>
  );
}
