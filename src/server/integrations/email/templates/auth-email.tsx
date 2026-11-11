import { Text } from 'react-email';

import { emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, mutedTextStyle, textStyle } from './layout';

export type AuthEmailKind = 'verify_email' | 'reset_password';

const KEY = { verify_email: 'verify', reset_password: 'reset' } as const;

export function authEmailSubject(locale: EmailLocale, kind: AuthEmailKind): string {
  return emailTranslator(locale)(`email.auth.${KEY[kind]}.subject`);
}

/** Account e-mails (verification, password reset) in the user's locale (§10.6). */
export function AuthEmail({
  locale,
  kind,
  url,
}: {
  locale: EmailLocale;
  kind: AuthEmailKind;
  url: string;
}) {
  const t = emailTranslator(locale);
  const key = KEY[kind];
  return (
    <EmailLayout
      locale={locale}
      preview={t(`email.auth.${key}.preview`)}
      heading={t(`email.auth.${key}.heading`)}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t(`email.auth.${key}.body`)}</Text>
      <EmailButton href={url}>{t(`email.auth.${key}.cta`)}</EmailButton>
      <Text style={mutedTextStyle}>{t(`email.auth.${key}.expiry`)}</Text>
      <Text style={mutedTextStyle}>{t(`email.auth.${key}.ignore`)}</Text>
    </EmailLayout>
  );
}
