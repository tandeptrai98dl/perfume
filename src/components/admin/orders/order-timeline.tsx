import { useTranslations } from 'next-intl';

import type { AdminOrderEvent, OrderStatus } from '@/server/modules/order';

import { useOrderFormat } from './format';

const STATUSES = new Set<string>([
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'returned',
]);

/** OrderTimeline (§8.4): status changes, notes and system events, newest first. */
export function OrderTimeline({ events }: { events: AdminOrderEvent[] }) {
  const t = useTranslations('admin.orders');
  const format = useOrderFormat();
  const status = (value: string | null) =>
    value && STATUSES.has(value) ? t(`status.${value as OrderStatus}`) : (value ?? '—');

  function title(event: AdminOrderEvent): string {
    switch (event.type) {
      case 'status_changed':
        return event.fromStatus
          ? t('timeline.status_changed', {
              from: status(event.fromStatus),
              to: status(event.toStatus),
            })
          : t('timeline.created', { to: status(event.toStatus) });
      case 'note':
        return t('timeline.note');
      case 'cod_risk_flagged':
        return t('timeline.cod_risk_flagged');
      default:
        return t('timeline.other', { type: event.type });
    }
  }

  if (events.length === 0) {
    return <p className="text-small text-taupe-600">{t('detail.timelineEmpty')}</p>;
  }

  return (
    <ol className="border-line-200 flex flex-col gap-4 border-l pl-5">
      {events.map((event) => {
        const carrier = event.metadata?.carrier;
        const tracking = event.metadata?.trackingCode;
        return (
          <li key={event.id} className="relative flex flex-col gap-1">
            <span aria-hidden className="bg-ink-950 absolute top-2 -left-[24px] size-2" />
            <p className="text-small font-medium">{title(event)}</p>
            {typeof carrier === 'string' && typeof tracking === 'string' && (
              <p className="text-small font-mono">
                {t('timeline.shipment', {
                  carrier: t(`carrier.${carrier as 'ghn'}`),
                  code: tracking,
                })}
              </p>
            )}
            {event.message && <p className="text-small whitespace-pre-line">{event.message}</p>}
            <p className="text-small text-taupe-600">
              <time dateTime={new Date(event.createdAt).toISOString()}>
                {format.dateTime(event.createdAt)}
              </time>
              {' · '}
              {event.actorName ?? t(`timeline.${event.actorType}`)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
