import { Text } from 'react-email';

import { emailFormatter, emailTranslator, type EmailLocale } from './i18n';
import { EmailButton, EmailLayout, mutedTextStyle, textStyle } from './layout';

/** Customer e-mails about a return request (ADR-0017), in the order's locale. */
export const RETURN_EMAIL_KINDS = ['requested', 'approved', 'rejected', 'received'] as const;
export type ReturnEmailKind = (typeof RETURN_EMAIL_KINDS)[number];

export type ReturnEmailLine = { productName: string; variantLabel: string; quantity: number };

export type ReturnEmailProps = {
  locale: EmailLocale;
  kind: ReturnEmailKind;
  code: string;
  customerName: string;
  orderUrl: string;
  lines: ReturnEmailLine[];
  /** `approved`: staff note (pickup / where to send); `rejected`: the reason. */
  note?: string | null;
  /** `received`: refund queued and owed later, or a replacement. */
  outcome?: 'full' | 'partial' | 'replacement' | null;
  refundTotal?: number;
  refundQueued?: number;
};

export function returnEmailSubject(locale: EmailLocale, kind: ReturnEmailKind, code: string) {
  return emailTranslator(locale)(`email.return.${kind}.subject`, { code });
}

export function ReturnUpdateEmail({
  locale,
  kind,
  code,
  customerName,
  orderUrl,
  lines,
  note = null,
  outcome = null,
  refundTotal = 0,
  refundQueued = 0,
}: ReturnEmailProps) {
  const t = emailTranslator(locale);
  const f = emailFormatter(locale);

  return (
    <EmailLayout
      locale={locale}
      preview={t(`email.return.${kind}.preview`, { code })}
      heading={t(`email.return.${kind}.heading`)}
      brand={t('metadata.siteName')}
      tagline={t('email.layout.tagline')}
      footer={t('email.layout.automated')}
    >
      <Text style={textStyle}>{t('email.layout.greeting', { name: customerName })}</Text>
      <Text style={textStyle}>{t(`email.return.${kind}.body`, { code })}</Text>
      {kind === 'approved' && note && (
        <Text style={textStyle}>{t('email.return.approved.note', { note })}</Text>
      )}
      {kind === 'rejected' && note && (
        <Text style={textStyle}>{t('email.return.rejected.reason', { reason: note })}</Text>
      )}
      {kind === 'received' &&
        (outcome === 'replacement' ? (
          <Text style={textStyle}>{t('email.return.received.replacement')}</Text>
        ) : refundTotal > 0 ? (
          <Text style={textStyle}>
            {t('email.return.received.refund', { amount: f.money(refundTotal) })}
            {refundQueued < refundTotal ? ` ${t('email.return.received.refundLater')}` : ''}
          </Text>
        ) : null)}
      {lines.length > 0 && (
        <>
          <Text style={textStyle}>{t('email.return.items')}</Text>
          {lines.map((line, index) => (
            <Text key={index} style={mutedTextStyle}>
              {t('email.return.item', {
                name: `${line.productName} ${line.variantLabel}`.trim(),
                quantity: line.quantity,
              })}
            </Text>
          ))}
        </>
      )}
      <EmailButton href={orderUrl}>{t('email.order.viewOrder')}</EmailButton>
      <Text style={mutedTextStyle}>{t('email.return.help')}</Text>
    </EmailLayout>
  );
}
