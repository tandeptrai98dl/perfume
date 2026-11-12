import { useFormatter, useTranslations } from 'next-intl';

export type ConsentHistoryItem = {
  id: string;
  purpose: 'terms' | 'privacy' | 'marketing_email' | 'marketing_sms' | 'analytics' | 'ads';
  granted: boolean;
  source: string;
  policyVersion: string;
  createdAt: string;
};

const PURPOSE_KEY = {
  terms: 'terms',
  privacy: 'privacy',
  marketing_email: 'marketingEmail',
  marketing_sms: 'marketingSms',
  analytics: 'analytics',
  ads: 'ads',
} as const;

const KNOWN_SOURCES = [
  'checkout',
  'account_profile',
  'privacy_center',
  'cookie_banner',
  'cookie_preferences',
  'guest_form',
  'newsletter',
  'privacy_erasure',
] as const;

/** Append-only consent log of the account (latest first). */
export function ConsentHistory({ entries }: { entries: ConsentHistoryItem[] }) {
  const t = useTranslations('privacyCenter.history');
  const format = useFormatter();
  if (entries.length === 0) return <p className="text-small text-taupe-600">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full min-w-[36rem] border-collapse text-left">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr className="border-line-200 border-b text-taupe-600">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.date')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.purpose')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.decision')}
            </th>
            <th scope="col" className="py-2 font-medium">
              {t('columns.source')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-line-200 border-b">
              <td className="py-3 pr-4 tabular-nums">
                {format.dateTime(new Date(entry.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </td>
              <td className="py-3 pr-4">{t(`purposes.${PURPOSE_KEY[entry.purpose]}`)}</td>
              <td className="py-3 pr-4">{entry.granted ? t('granted') : t('withdrawn')}</td>
              <td className="py-3">
                {(KNOWN_SOURCES as readonly string[]).includes(entry.source)
                  ? t(`sources.${entry.source as (typeof KNOWN_SOURCES)[number]}`)
                  : entry.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
