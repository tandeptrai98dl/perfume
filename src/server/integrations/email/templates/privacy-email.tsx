import { Text } from 'react-email';

import { emailFormatter, emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, mutedTextStyle, textStyle } from './layout';

/** Data-subject request e-mails (PDPL 91/2025, Decree 356/2025), in the requester's locale. */

export type PrivacyEmailKind = 'verify' | 'received' | 'exportReady' | 'completed' | 'rejected';
export type PrivacyEmailRequestType = 'export' | 'delete' | 'correct' | 'withdraw_consent';

const TYPE_KEY = {
  export: 'export',
  delete: 'delete',
  correct: 'correct',
  withdraw_consent: 'withdrawConsent',
} as const;

export function privacyEmailSubject(locale: EmailLocale, kind: PrivacyEmailKind): string {
  return emailTranslator(locale)(`email.privacy.${kind}.subject`);
}

export function PrivacyEmail({
  locale,
  kind,
  type,
  url,
  dueAt,
  expiresAt,
  note,
}: {
  locale: EmailLocale;
  kind: PrivacyEmailKind;
  type: PrivacyEmailRequestType;
  /** Confirmation link (verify), download link (exportReady) or privacy centre / form link. */
  url?: string | null;
  dueAt?: Date | null;
  expiresAt?: Date | null;
  /** Staff note shown on completion / rejection. */
  note?: string | null;
}) {
  const t = emailTranslator(locale);
  const format = emailFormatter(locale);
  const typeLabel = t(`email.privacy.types.${TYPE_KEY[type]}`);
  return (
    <EmailLayout
      locale={locale}
      preview={t(`email.privacy.${kind}.preview`, { type: typeLabel })}
      heading={t(`email.privacy.${kind}.heading`)}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t(`email.privacy.${kind}.body`, { type: typeLabel })}</Text>
      {dueAt && (
        <Text style={textStyle}>{t('email.privacy.dueAt', { date: format.date(dueAt) })}</Text>
      )}
      {note && <Text style={textStyle}>{t('email.privacy.note', { note })}</Text>}
      {url && <EmailButton href={url}>{t(`email.privacy.${kind}.cta`)}</EmailButton>}
      {expiresAt && (
        <Text style={mutedTextStyle}>
          {t('email.privacy.expiresAt', { date: format.date(expiresAt) })}
        </Text>
      )}
      <Text style={mutedTextStyle}>{t(`email.privacy.${kind}.ignore`)}</Text>
    </EmailLayout>
  );
}
