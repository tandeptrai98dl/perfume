import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { OrderView } from '@/server/modules/order';
import type { CustomerReturnView } from '@/server/modules/returns';

import { ReturnRequestForm } from './return-request-form';

/**
 * Returns block of the order page (account and guest lookup, ADR-0017): the request form while
 * the window is open, the request's progress afterwards, or the end of the window.
 * Nothing for orders that were never delivered.
 */
export function ReturnSection({
  order,
  view,
  token,
}: {
  order: Pick<OrderView, 'code' | 'items'>;
  view: CustomerReturnView;
  token?: string | null;
}) {
  const t = useTranslations('returns');
  const format = useFormatter();
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });
  const money = (amount: number) => format.number(amount, 'vnd');
  const { request } = view;

  if (!request && !view.canRequest && view.ineligibility !== 'windowExpired') return null;

  const policyLink = (
    <Link
      href={{ pathname: '/policies/[slug]', params: { slug: t('policySlug') } }}
      className="text-gold-700 hover:underline"
    >
      {t('policyLink')}
    </Link>
  );

  return (
    <section
      aria-labelledby="order-returns"
      className="border-line-200 flex flex-col gap-4 border-t pt-8"
      data-testid="order-returns"
    >
      <h2 id="order-returns" className="text-h3">
        {t('title')}
      </h2>

      {request ? (
        <div className="bg-sand-100 flex flex-col gap-2 p-6" role="status">
          <p className="font-medium">{t(`status.${request.status}`)}</p>
          <p className="text-small">
            {request.status === 'requested'
              ? t('statusBody.requested', { date: date(request.requestedAt) })
              : t(`statusBody.${request.status}`)}
          </p>
          <ul className="text-small flex flex-col gap-1">
            <li>{t('summary.reason', { reason: t(`reasons.${request.reason}`) })}</li>
            <li>
              {t('summary.resolution', { resolution: t(`resolutions.${request.resolution}`) })}
            </li>
            {request.lines.map((line) => {
              const item = order.items.find((candidate) => candidate.id === line.orderItemId);
              return item ? (
                <li key={line.orderItemId}>
                  {t('summary.item', {
                    name: `${item.productName} ${item.variantLabel}`.trim(),
                    quantity: line.quantity,
                  })}
                </li>
              ) : null;
            })}
          </ul>
          {request.status === 'approved' && request.approvalNote && (
            <p className="text-small whitespace-pre-line">
              {t('summary.note', { note: request.approvalNote })}
            </p>
          )}
          {request.status === 'rejected' && request.rejectionReason && (
            <p className="text-small whitespace-pre-line">
              {t('summary.rejection', { reason: request.rejectionReason })}
            </p>
          )}
          {request.status === 'received' &&
            (request.outcome === 'replacement' ? (
              <p className="text-small">{t('summary.replacement')}</p>
            ) : (
              request.refundTotal !== null &&
              request.refundTotal > 0 && (
                <p className="text-small">
                  {t('summary.refund', { amount: money(request.refundTotal) })}
                </p>
              )
            ))}
          <p className="text-small">{policyLink}</p>
        </div>
      ) : view.canRequest && view.deadline ? (
        <>
          <p>{t('eligible', { deadline: date(view.deadline) })}</p>
          <p className="text-small text-taupe-600">
            {t('policy', { days: view.windowDays })} {policyLink}
          </p>
          <ReturnRequestForm
            code={order.code}
            token={token}
            items={order.items.map((item) => ({
              id: item.id,
              productName: item.productName,
              variantLabel: item.variantLabel,
              quantity: item.quantity,
            }))}
          />
        </>
      ) : (
        view.deadline && (
          <p className="text-small text-taupe-600">
            {t('windowExpired', { date: date(view.deadline) })} {policyLink}
          </p>
        )
      )}
    </section>
  );
}
