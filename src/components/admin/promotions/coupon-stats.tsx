import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { CouponForEdit } from '@/server/modules/promotion';

import { useOrderFormat } from '../orders/format';

/** Usage statistics of one coupon (§11.2 "usage statistics"). */
export function CouponStats({ coupon }: { coupon: CouponForEdit }) {
  const t = useTranslations('admin.coupons.stats');
  const format = useOrderFormat();
  const { usage } = coupon;
  return (
    <section
      aria-labelledby="coupon-stats"
      className="border-line-200 flex flex-col gap-4 border bg-white p-5"
    >
      <h2 id="coupon-stats" className="text-h3">
        {t('title')}
      </h2>
      <dl className="text-small grid grid-cols-2 gap-3">
        <div>
          <dt className="text-taupe-600">{t('redemptions')}</dt>
          <dd className="text-h3 tabular-nums">{usage.redemptions}</dd>
        </div>
        <div>
          <dt className="text-taupe-600">{t('discountTotal')}</dt>
          <dd className="text-h3 tabular-nums">{format.vnd(usage.discountTotal)}</dd>
        </div>
        <div>
          <dt className="text-taupe-600">{t('uniqueCustomers')}</dt>
          <dd className="text-h3 tabular-nums">{usage.uniqueCustomers}</dd>
        </div>
        <div>
          <dt className="text-taupe-600">{t('lastUsed')}</dt>
          <dd className="tabular-nums">
            {usage.lastUsedAt ? format.dateTime(usage.lastUsedAt) : t('never')}
          </dd>
        </div>
      </dl>
      {coupon.recentRedemptions.length > 0 && (
        <table className="text-small w-full border-collapse text-left">
          <caption className="text-body mb-2 text-left font-medium">{t('recent')}</caption>
          <thead className="bg-sand-100">
            <tr>
              <th scope="col" className="px-2 py-1 font-medium">
                {t('order')}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                {t('amount')}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                {t('date')}
              </th>
            </tr>
          </thead>
          <tbody>
            {coupon.recentRedemptions.map((row) => (
              <tr key={row.orderId} className="border-line-200 border-t">
                <td className="px-2 py-1">
                  <Link
                    href={`/admin/orders/${row.orderId}` as Route}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    {row.orderCode}
                  </Link>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{format.vnd(row.amount)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{format.date(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
