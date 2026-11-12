import { Link, Text } from 'react-email';

import { emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, mutedTextStyle, textStyle } from './layout';
import { emailTheme as theme } from './theme';

/** Newsletter e-mails (double opt-in confirmation, welcome), in the subscriber's locale. */

export type NewsletterEmailKind = 'confirm' | 'welcome';

export function newsletterEmailSubject(locale: EmailLocale, kind: NewsletterEmailKind): string {
  return emailTranslator(locale)(`email.newsletter.${kind}.subject`);
}

export function NewsletterEmail({
  locale,
  kind,
  url,
  unsubscribeUrl,
}: {
  locale: EmailLocale;
  kind: NewsletterEmailKind;
  /** Confirmation link (confirm) or the shop (welcome). */
  url: string;
  /** Signed unsubscribe page (welcome; every marketing e-mail carries one). */
  unsubscribeUrl?: string | null;
}) {
  const t = emailTranslator(locale);
  return (
    <EmailLayout
      locale={locale}
      preview={t(`email.newsletter.${kind}.preview`)}
      heading={t(`email.newsletter.${kind}.heading`)}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t(`email.newsletter.${kind}.body`)}</Text>
      <EmailButton href={url}>{t(`email.newsletter.${kind}.cta`)}</EmailButton>
      {kind === 'confirm' && (
        <Text style={mutedTextStyle}>{t('email.newsletter.confirm.expires')}</Text>
      )}
      {kind === 'confirm' && (
        <Text style={mutedTextStyle}>{t('email.newsletter.confirm.ignore')}</Text>
      )}
      {unsubscribeUrl && (
        <Text style={mutedTextStyle}>
          {t('email.newsletter.unsubscribeText')}{' '}
          <Link href={unsubscribeUrl} style={{ color: theme.color.ink950 }}>
            {t('email.newsletter.unsubscribeLink')}
          </Link>
        </Text>
      )}
    </EmailLayout>
  );
}
