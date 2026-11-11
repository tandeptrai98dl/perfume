import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { Route } from 'next';

import type { PrintableOrder, PrintDocument } from '@/server/modules/order';

import { useOrderFormat } from './format';
import { PrintButton } from './print-button';

/*
 * PrintPackingSlip / delivery slip (§8.4, §11.2): one order per printed page, no admin chrome.
 * Packing slips of gift orders with "hide prices" carry no price at all.
 */

export function PrintDocuments({
  document,
  orders,
  backHref,
}: {
  document: PrintDocument;
  orders: PrintableOrder[];
  backHref: string;
}) {
  const t = useTranslations('admin.orders.print');
  return (
    <div className="bg-ivory-50 min-h-dvh print:bg-white">
      <div className="border-line-200 flex flex-wrap items-center gap-3 border-b bg-white px-6 py-3 print:hidden">
        <Link href={backHref as Route} className="text-small underline-offset-4 hover:underline">
          {t('back')}
        </Link>
        <h1 className="text-h3 mr-auto">
          {t(document)} · {t('count', { count: orders.length })}
        </h1>
        {orders.length > 0 && <PrintButton label={t('print')} />}
      </div>
      <main className="mx-auto flex max-w-[210mm] flex-col gap-8 p-6 print:max-w-none print:gap-0 print:p-0">
        {orders.length === 0 && <p>{t('empty')}</p>}
        {orders.map((order) =>
          document === 'packing-slip' ? (
            <PackingSlip key={order.id} order={order} />
          ) : (
            <DeliverySlip key={order.id} order={order} />
          ),
        )}
      </main>
    </div>
  );
}

function SlipHeader({ order, title }: { order: PrintableOrder; title: string }) {
  const t = useTranslations('admin.orders.print');
  const format = useOrderFormat();
  return (
    <header className="border-ink-950 flex items-end justify-between gap-4 border-b-2 pb-3">
      <div>
        <p className="eyebrow">{t('shopName')}</p>
        <h2 className="text-h2">{title}</h2>
      </div>
      <dl className="text-small text-right">
        <dt className="sr-only">{t('orderCode')}</dt>
        <dd className="text-h3 font-mono">{order.code}</dd>
        <dt className="inline">{t('date')}: </dt>
        <dd className="inline tabular-nums">{format.dateTime(order.placedAt)}</dd>
      </dl>
    </header>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <article className="shadow-overlay flex break-after-page flex-col gap-5 bg-white p-8 print:min-h-0 print:p-0 print:shadow-none">
      {children}
    </article>
  );
}

function PackingSlip({ order }: { order: PrintableOrder }) {
  const t = useTranslations('admin.orders.print');
  const tDetail = useTranslations('admin.orders.detail');
  const format = useOrderFormat();
  const slip = order.packingSlip;
  return (
    <Sheet>
      <SlipHeader order={order} title={t('packing-slip')} />
      <p className="text-small">
        <span className="font-medium">{t('recipient')}: </span>
        {order.shippingAddress?.fullName ?? order.customerName}
      </p>
      <table className="text-small w-full border-collapse text-left">
        <thead>
          <tr className="border-ink-950 border-b">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t('sku')}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t('product')}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              {t('quantity')}
            </th>
            {slip.showPrices && (
              <>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('unitPrice')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('lineTotal')}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((line) => (
            <tr key={line.sku} className="border-line-200 border-b">
              <td className="py-2 pr-3 font-mono">{line.sku}</td>
              <td className="py-2 pr-3">
                {line.productName} · {line.variantLabel}
              </td>
              <td className="text-h3 py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
              {slip.showPrices && (
                <>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {line.unitPrice === null ? '' : format.vnd(line.unitPrice)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {line.lineTotal === null ? '' : format.vnd(line.lineTotal)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-small font-medium">{t('units', { count: slip.units })}</p>
      {slip.totals ? (
        <dl className="text-small ml-auto flex w-64 flex-col gap-1">
          <div className="flex justify-between">
            <dt>{tDetail('subtotal')}</dt>
            <dd className="tabular-nums">{format.vnd(slip.totals.subtotal)}</dd>
          </div>
          {slip.totals.discountTotal > 0 && (
            <div className="flex justify-between">
              <dt>{tDetail('discount')}</dt>
              <dd className="tabular-nums">−{format.vnd(slip.totals.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>{tDetail('shippingFee')}</dt>
            <dd className="tabular-nums">{format.vnd(slip.totals.shippingFee)}</dd>
          </div>
          {slip.totals.giftWrapFee > 0 && (
            <div className="flex justify-between">
              <dt>{tDetail('giftWrapFee')}</dt>
              <dd className="tabular-nums">{format.vnd(slip.totals.giftWrapFee)}</dd>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <dt>{tDetail('total')}</dt>
            <dd className="tabular-nums">{format.vnd(slip.totals.total)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-small italic">{t('pricesHidden')}</p>
      )}
      {(order.giftWrap || order.giftMessage) && (
        <section className="border-gold-500 flex flex-col gap-1 border p-4">
          {order.giftWrap && <p className="text-small font-medium">{t('giftWrap')}</p>}
          {order.giftMessage && (
            <>
              <h3 className="eyebrow">{t('giftMessage')}</h3>
              <p className="text-body-lg font-display whitespace-pre-line">{order.giftMessage}</p>
            </>
          )}
        </section>
      )}
      {order.customerNote && (
        <p className="text-small">
          <span className="font-medium">{t('customerNote')}: </span>
          {order.customerNote}
        </p>
      )}
      <Signatures labels={[t('packedBy'), t('checkedBy')]} />
    </Sheet>
  );
}

function DeliverySlip({ order }: { order: PrintableOrder }) {
  const t = useTranslations('admin.orders.print');
  const tOrders = useTranslations('admin.orders');
  const format = useOrderFormat();
  const address = order.shippingAddress;
  return (
    <Sheet>
      <SlipHeader order={order} title={t('delivery-slip')} />
      <section className="flex flex-col gap-1">
        <h3 className="eyebrow">{t('shipTo')}</h3>
        <p className="text-h3">{address?.fullName ?? order.customerName}</p>
        <p className="text-body-lg tabular-nums">
          {t('phone')}: {address?.phone ?? order.phone}
        </p>
        {address && (
          <p className="text-body-lg">
            {address.street}, {address.wardName}, {address.provinceName}
            {address.legacyDistrict ? ` (${address.legacyDistrict})` : ''}
          </p>
        )}
      </section>
      <div className="border-ink-950 grid grid-cols-2 gap-4 border-2 p-4">
        <div>
          <p className="eyebrow">{t('codAmount')}</p>
          <p className="text-h2 tabular-nums">
            {order.money.codToCollect > 0 ? format.vnd(order.money.codToCollect) : t('noCod')}
          </p>
        </div>
        <div>
          <p className="eyebrow">{t('tracking')}</p>
          {order.shipment ? (
            <p className="text-h3 font-mono">
              {tOrders(`carrier.${order.shipment.carrier as 'ghn'}`)} ·{' '}
              {order.shipment.trackingCode}
            </p>
          ) : (
            <p className="text-small">{t('noShipment')}</p>
          )}
        </div>
      </div>
      <p className="text-small">{t('units', { count: order.packingSlip.units })}</p>
      {order.customerNote && (
        <p className="text-small">
          <span className="font-medium">{t('customerNote')}: </span>
          {order.customerNote}
        </p>
      )}
      <Signatures labels={[t('sender'), t('receivedBy')]} />
    </Sheet>
  );
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-8">
      {labels.map((label) => (
        <div key={label} className="flex flex-col gap-12">
          <p className="text-small font-medium">{label}</p>
          <div className="border-line-200 border-b" />
        </div>
      ))}
    </div>
  );
}
