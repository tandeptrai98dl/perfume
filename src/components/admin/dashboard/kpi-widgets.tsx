import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import type {
  CashSummary,
  DailyPoint,
  RangePreset,
  SalesSummary,
  StatusCount,
  TopProduct,
} from '@/server/modules/reporting';

import { OrderStatusBadge } from '../orders/order-badges';
import { useOrderFormat } from '../orders/format';

/*
 * KPI dashboard widgets (§11.2). Charts are plain CSS bars (no chart library): one series in
 * one hue (`gold-700`, ≥ 3:1 against white for non-text contrast), values always available as
 * text — visible labels on the status and product bars, a data table behind the daily chart.
 */

const BAR = 'bg-gold-700';

/** `YYYY-MM-DD` (a Vietnam date) → instant at Vietnam midnight, for formatting. */
const vietnamDay = (day: string) => new Date(`${day}T00:00:00+07:00`);

/** Segmented range control: plain links, so it works without JavaScript and by keyboard. */
export function RangeTabs({
  active,
  presets,
}: {
  active: RangePreset;
  presets: readonly RangePreset[];
}) {
  const t = useTranslations('admin.dashboard');
  return (
    <nav aria-label={t('rangeLabel')}>
      <ul className="border-line-200 inline-flex flex-wrap border">
        {presets.map((preset) => (
          <li key={preset}>
            <Link
              href={`/admin?range=${preset}` as Route}
              aria-current={preset === active ? 'page' : undefined}
              className={cn(
                'text-small inline-flex min-h-11 items-center px-4',
                preset === active
                  ? 'bg-ink-950 text-ivory-50'
                  : 'text-ink-950 hover:bg-sand-100 bg-white',
              )}
            >
              {t(`ranges.${preset}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-line-200 flex flex-col gap-1 border bg-white p-4">
      <dt className="text-small text-taupe-600">{label}</dt>
      <dd className="text-h2 tabular-nums">{value}</dd>
      {hint && <dd className="text-small text-taupe-600">{hint}</dd>}
    </div>
  );
}

export function KpiTiles({
  sales,
  cash,
  showMoney,
}: {
  sales: SalesSummary;
  cash: CashSummary | null;
  showMoney: boolean;
}) {
  const t = useTranslations('admin.dashboard');
  const format = useFormatter();
  const money = useOrderFormat();
  const conversion =
    sales.conversionRate === null
      ? '—'
      : format.number(sales.conversionRate, { style: 'percent', maximumFractionDigits: 1 });
  return (
    <section aria-labelledby="dashboard-kpis" className="flex flex-col gap-3">
      <h2 id="dashboard-kpis" className="sr-only">
        {t('kpis')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {showMoney && (
          <Tile
            label={t('netRevenue')}
            value={money.vnd(sales.netRevenue)}
            hint={t('netRevenueHint', { refunded: money.vnd(sales.refunded) })}
          />
        )}
        {showMoney && cash && (
          <Tile
            label={t('cashNet')}
            value={money.vnd(cash.net)}
            hint={t('cashHint', {
              received: money.vnd(cash.received),
              refunded: money.vnd(cash.refunded),
            })}
          />
        )}
        <Tile
          label={t('ordersPlaced')}
          value={format.number(sales.ordersPlaced)}
          hint={t('ordersPlacedHint', { count: sales.revenueOrders })}
        />
        {showMoney && (
          <Tile
            label={t('averageOrderValue')}
            value={money.vnd(sales.averageOrderValue)}
            hint={t('averageOrderValueHint')}
          />
        )}
        <Tile
          label={t('conversion')}
          value={conversion}
          hint={
            sales.cartsCreated
              ? t('conversionHint', { orders: sales.webOrders, carts: sales.cartsCreated })
              : t('conversionNone')
          }
        />
      </dl>
    </section>
  );
}

export function DailyRevenueChart({ points }: { points: DailyPoint[] }) {
  const t = useTranslations('admin.dashboard');
  const format = useFormatter();
  const money = useOrderFormat();
  const max = Math.max(1, ...points.map((point) => point.netRevenue));
  const day = (value: string) =>
    format.dateTime(vietnamDay(value), { day: '2-digit', month: '2-digit' });
  // Label every day up to two weeks, then roughly every fifth day.
  const labelEvery = points.length > 14 ? 5 : 1;
  return (
    <section
      aria-labelledby="dashboard-daily"
      className="border-line-200 flex flex-col gap-4 border bg-white p-4"
    >
      <h2 id="dashboard-daily" className="text-h3">
        {t('dailyTitle')}
      </h2>
      {/* Visual only; the same figures are in the table below. */}
      <div aria-hidden className="flex flex-col gap-1">
        <div className="border-line-200 flex h-48 items-end gap-0.5 border-b">
          {points.map((point) => (
            <div key={point.day} className="group relative flex h-full flex-1 items-end">
              <div
                className={cn(BAR, 'group-hover:bg-ink-950 w-full')}
                style={{ height: `${(point.netRevenue / max) * 100}%` }}
              />
              <span className="text-eyebrow bg-ink-950 text-ivory-50 pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 px-2 py-1 whitespace-nowrap group-hover:block">
                {t('dailyBar', {
                  day: day(point.day),
                  amount: money.vnd(point.netRevenue),
                  orders: point.orders,
                })}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-0.5">
          {points.map((point, index) => (
            <span key={point.day} className="text-eyebrow flex-1 text-center text-taupe-600">
              {index % labelEvery === 0 ? day(point.day) : ''}
            </span>
          ))}
        </div>
      </div>
      <details>
        <summary className="text-small cursor-pointer underline-offset-4 hover:underline">
          {t('showTable')}
        </summary>
        <div className="mt-2">
          <table className="text-small w-full text-left">
            <caption className="sr-only">{t('dailyTitle')}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 font-medium">
                  {t('columns.day')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('columns.netRevenue')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('columns.orders')}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.day} className="border-line-200 border-t">
                  <th scope="row" className="py-1 font-normal">
                    {day(point.day)}
                  </th>
                  <td className="py-1 text-right tabular-nums">{money.vnd(point.netRevenue)}</td>
                  <td className="py-1 text-right tabular-nums">{point.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function StatusBreakdown({ rows }: { rows: StatusCount[] }) {
  const t = useTranslations('admin.dashboard');
  const max = Math.max(1, ...rows.map((row) => row.orders));
  return (
    <section
      aria-labelledby="dashboard-statuses"
      className="border-line-200 flex flex-col gap-3 border bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="dashboard-statuses" className="text-h3">
          {t('byStatusTitle')}
        </h2>
        <p className="text-small text-taupe-600">{t('byStatusHint')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-small text-taupe-600">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.status} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3">
              <Link
                href={`/admin/orders?status=${row.status}` as Route}
                className="hover:underline"
              >
                <OrderStatusBadge status={row.status} />
              </Link>
              <span aria-hidden className="bg-sand-100 h-3">
                <span
                  className={cn(BAR, 'block h-full')}
                  style={{ width: `${(row.orders / max) * 100}%` }}
                />
              </span>
              <span className="text-small text-right tabular-nums">{row.orders}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TopProductsTable({ rows }: { rows: TopProduct[] }) {
  const t = useTranslations('admin.dashboard');
  const money = useOrderFormat();
  const max = Math.max(1, ...rows.map((row) => row.units));
  return (
    <section
      aria-labelledby="dashboard-top"
      className="border-line-200 flex flex-col gap-3 border bg-white p-4"
    >
      <h2 id="dashboard-top" className="text-h3">
        {t('topProducts')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-small text-taupe-600">{t('topProductsEmpty')}</p>
      ) : (
        <table className="text-small w-full text-left">
          <caption className="sr-only">{t('topProducts')}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 font-medium">
                {t('columns.product')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('columns.units')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('columns.revenue')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId} className="border-line-200 border-t">
                <th scope="row" className="py-2 pr-3 font-normal">
                  <Link
                    href={`/admin/products/${row.productId}` as Route}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span aria-hidden className="bg-sand-100 mt-1 block h-1.5">
                    <span
                      className={cn(BAR, 'block h-full')}
                      style={{ width: `${(row.units / max) * 100}%` }}
                    />
                  </span>
                </th>
                <td className="py-2 text-right tabular-nums">{row.units}</td>
                <td className="py-2 text-right tabular-nums">{money.vnd(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export type AttentionItem = {
  key: string;
  label: string;
  value: string;
  href: string;
  alert?: boolean;
};

/** Counters of work waiting in other screens; each opens the screen that handles it. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const t = useTranslations('admin.dashboard');
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="dashboard-attention" className="flex flex-col gap-3">
      <h2 id="dashboard-attention" className="text-h3">
        {t('attention')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.key}>
            {/* No prefetch: these are secondary links to other work screens. */}
            <Link
              href={item.href as Route}
              prefetch={false}
              className={cn(
                'hover:border-ink-950 flex h-full flex-col gap-1 border bg-white p-4',
                item.alert ? 'border-warning' : 'border-line-200',
              )}
            >
              <span className="text-small text-taupe-600">{item.label}</span>
              <span className="text-body font-medium tabular-nums">{item.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
