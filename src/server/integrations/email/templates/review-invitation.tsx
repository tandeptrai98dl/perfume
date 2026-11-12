import { Link, Section, Text } from 'react-email';

import { emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, eyebrowStyle, mutedTextStyle, textStyle } from './layout';
import { emailTheme as theme } from './theme';

/**
 * Review invitation after delivery (ADR-0008), in the order's locale. Guests get one
 * one-time link per purchased line (valid 30 days); members get a link to "Reviews to write"
 * in their account.
 */

export type ReviewInvitationItem = {
  productName: string;
  variantLabel: string;
  /** Guest: the one-time review link of this line. */
  url?: string;
};

export type ReviewInvitationProps = {
  locale: EmailLocale;
  kind: 'guest' | 'member';
  customerName: string;
  orderCode: string;
  items: ReviewInvitationItem[];
  /** Member: account page listing the purchases to review. */
  accountUrl?: string;
  /** Guest links validity in days. */
  validDays?: number;
};

export function reviewInvitationSubject(locale: EmailLocale, orderCode: string): string {
  return emailTranslator(locale)('email.review.subject', { code: orderCode });
}

export function ReviewInvitationEmail({
  locale,
  kind,
  customerName,
  orderCode,
  items,
  accountUrl,
  validDays = 30,
}: ReviewInvitationProps) {
  const t = emailTranslator(locale);
  return (
    <EmailLayout
      locale={locale}
      preview={t('email.review.preview')}
      heading={t('email.review.heading')}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t('email.review.greeting', { name: customerName })}</Text>
      <Text style={textStyle}>{t('email.review.body', { code: orderCode })}</Text>
      <Text style={eyebrowStyle}>{t('email.review.items')}</Text>
      {items.map((item, index) => (
        <Section
          key={`${item.productName}-${index}`}
          style={{ borderTop: `1px solid ${theme.color.line200}`, padding: '12px 0' }}
        >
          <Text style={{ ...textStyle, margin: '0 0 4px', fontWeight: 600 }}>
            {item.productName}
          </Text>
          <Text style={{ ...mutedTextStyle, margin: '0 0 8px' }}>{item.variantLabel}</Text>
          {kind === 'guest' && item.url && (
            <Link href={item.url} style={{ color: theme.color.ink950, fontWeight: 500 }}>
              {t('email.review.writeFor', { product: item.productName })}
            </Link>
          )}
        </Section>
      ))}
      {kind === 'member' && accountUrl && (
        <EmailButton href={accountUrl}>{t('email.review.cta')}</EmailButton>
      )}
      <Text style={mutedTextStyle}>
        {kind === 'guest'
          ? t('email.review.guestNote', { days: validDays })
          : t('email.review.memberNote')}
      </Text>
      <Text style={mutedTextStyle}>{t('email.review.moderation')}</Text>
    </EmailLayout>
  );
}
