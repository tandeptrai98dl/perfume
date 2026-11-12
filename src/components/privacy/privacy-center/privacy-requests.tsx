import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

export type PrivacyRequestItem = {
  id: string;
  type: 'export' | 'delete' | 'correct' | 'withdraw_consent';
  status: 'received' | 'in_progress' | 'completed' | 'rejected';
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
  /** Completed export still inside its download window. */
  downloadable: boolean;
};

const TYPE_KEY = {
  export: 'export',
  delete: 'delete',
  correct: 'correct',
  withdraw_consent: 'withdrawConsent',
} as const;

const STATUS_KEY = {
  received: 'received',
  in_progress: 'inProgress',
  completed: 'completed',
  rejected: 'rejected',
} as const;

const TONES = {
  received: 'neutral',
  in_progress: 'warning',
  completed: 'success',
  rejected: 'outline',
} as const;

/** The member's requests with status and legal due date. */
export function PrivacyRequests({ requests }: { requests: PrivacyRequestItem[] }) {
  const t = useTranslations('privacyCenter.requests');
  const format = useFormatter();
  if (requests.length === 0) {
    return <p className="text-small text-taupe-600">{t('empty')}</p>;
  }
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' });
  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full min-w-[36rem] border-collapse text-left">
        <caption className="sr-only">{t('listCaption')}</caption>
        <thead>
          <tr className="border-line-200 border-b text-taupe-600">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.type')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.createdAt')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.status')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('columns.dueAt')}
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">{t('columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr
              key={request.id}
              className="border-line-200 border-b"
              data-testid="privacy-request-row"
            >
              <td className="py-3 pr-4">{t(`types.${TYPE_KEY[request.type]}`)}</td>
              <td className="py-3 pr-4 tabular-nums">{date(request.createdAt)}</td>
              <td className="py-3 pr-4">
                <Badge variant={TONES[request.status]}>
                  {t(`status.${STATUS_KEY[request.status]}`)}
                </Badge>
              </td>
              <td className="py-3 pr-4 tabular-nums">
                {request.completedAt ? date(request.completedAt) : date(request.dueAt)}
              </td>
              <td className="py-3">
                {request.downloadable && (
                  <a
                    href={`/api/privacy/export/${request.id}`}
                    download
                    className="text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    {t('download')}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
