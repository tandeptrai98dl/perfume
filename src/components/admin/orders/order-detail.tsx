import { Printer, TriangleAlert } from 'lucide-react';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { AdminOrderAddress, AdminOrderDetail } from '@/server/modules/order';

import { OrderActions } from './order-actions';
import { OrderNoteForm } from './order-note-form';
import { OrderTimeline } from './order-timeline';
import { useOrderFormat } from './format';

/*
 * OrderDetailPanel (§8.4, §11.2): everything a staff member needs to process the order on one
 * screen — actions first, then customer, items/totals, payments, shipments and the timeline.
 */

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section
      aria-labelledby={id}
      className="border-line-200 flex flex-col gap-4 border bg-white p-5"
    >
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={strong ? 'flex justify-between gap-4 font-medium' : 'flex justify-between gap-4'}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

function Address({ address }: { address: AdminOrderAddress | null }) {
  const t = useTranslations('admin.orders.detail');
  if (!address) return <p className="text-small text-taupe-600">{t('noAddress')}</p>;
  return (
    <address className="text-small flex flex-col not-italic">
      <span className="font-medium">{address.fullName}</span>
      <span className="tabular-nums">{address.phone}</span>
      <span>{address.street}</span>
      <span>
        {address.wardName}, {address.provinceName}
      </span>
      {address.legacyDistrict && (
        <span className="text-taupe-600">
          {t('legacyDistrict', { name: address.legacyDistrict })}
        </span>
      )}
    </address>
  );
}

export function OrderDetailView({
  order,
  canCancelPaid,
}: {
  order: AdminOrderDetail;
  canCancelPaid: boolean;
}) {
  const t = useTranslations('admin.orders');
  const format = useOrderFormat();
  const { money } = order;
  const risky =
    order.paymentMethod === 'cod' &&
    (order.codRisk.accountFlagged || order.codRisk.failedDeliveries > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {risky && (
          <div role="alert" className="border-warning text-warning flex gap-3 border bg-white p-4">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div className="text-small flex flex-col gap-1">
              <p className="font-medium">{t('detail.risk.title')}</p>
              {order.codRisk.accountFlagged && <p>{t('detail.risk.account')}</p>}
              {order.codRisk.failedDeliveries > 0 && (
                <p>{t('detail.risk.phone', { count: order.codRisk.failedDeliveries })}</p>
              )}
              <p>{t('detail.risk.advice')}</p>
            </div>
          </div>
        )}

        <Section id="order-items" title={t('detail.items')}>
          <div className="overflow-x-auto">
            <table className="text-small w-full border-collapse text-left">
              <caption className="sr-only">{t('detail.items')}</caption>
              <thead className="bg-sand-100">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('detail.itemColumns.product')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('detail.itemColumns.sku')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('detail.itemColumns.unitPrice')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('detail.itemColumns.quantity')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('detail.itemColumns.discount')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('detail.itemColumns.lineTotal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-line-200 border-t">
                    <td className="px-3 py-2">
                      <span className="flex flex-col">
                        <span className="font-medium">{item.productName}</span>
                        <span className="text-taupe-600">{item.variantLabel}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{item.sku}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {format.vnd(item.unitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.discountAllocated > 0 ? `−${format.vnd(item.discountAllocated)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {format.vnd(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="text-small ml-auto flex w-full max-w-sm flex-col gap-1">
            <Row label={t('detail.subtotal')}>{format.vnd(order.subtotal)}</Row>
            {order.discountTotal > 0 && (
              <Row
                label={
                  order.couponCode
                    ? `${t('detail.discount')} (${t('detail.coupon', { code: order.couponCode })})`
                    : t('detail.discount')
                }
              >
                −{format.vnd(order.discountTotal)}
              </Row>
            )}
            <Row label={t('detail.shippingFee')}>{format.vnd(order.shippingFee)}</Row>
            {order.giftWrapFee > 0 && (
              <Row label={t('detail.giftWrapFee')}>{format.vnd(order.giftWrapFee)}</Row>
            )}
            <Row label={t('detail.total')} strong>
              {format.vnd(order.total)}
            </Row>
            {money.depositRequired > 0 && (
              <Row label={t('detail.deposit')}>{format.vnd(money.depositRequired)}</Row>
            )}
            {money.depositOutstanding > 0 && (
              <Row label={t('detail.depositOutstanding')}>
                {format.vnd(money.depositOutstanding)}
              </Row>
            )}
            <Row label={t('detail.paid')}>{format.vnd(order.amountPaid)}</Row>
            {order.amountRefunded > 0 && (
              <Row label={t('detail.refunded')}>{format.vnd(order.amountRefunded)}</Row>
            )}
            <Row label={t('detail.due')} strong>
              {format.vnd(money.amountDue)}
            </Row>
            {money.codToCollect > 0 && (
              <Row label={t('detail.codToCollect')}>{format.vnd(money.codToCollect)}</Row>
            )}
            {money.refundOwed > 0 && (
              <Row label={t('detail.refundOwed')} strong>
                {format.vnd(money.refundOwed)}
              </Row>
            )}
          </dl>
          {money.refundOwed > 0 && (
            <p role="note" className="text-small border-warning border-l-2 pl-3">
              {t('detail.refundOwedHint', { amount: format.vnd(money.refundOwed) })}
            </p>
          )}
        </Section>

        <Section id="order-payments" title={t('detail.payments')}>
          {order.payments.length === 0 ? (
            <p className="text-small text-taupe-600">{t('detail.paymentsEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-small w-full border-collapse text-left">
                <caption className="sr-only">{t('detail.payments')}</caption>
                <thead className="bg-sand-100">
                  <tr>
                    {(['provider', 'kind', 'amount', 'status', 'date', 'reference'] as const).map(
                      (key) => (
                        <th key={key} scope="col" className="px-3 py-2 font-medium">
                          {t(`detail.paymentColumns.${key}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((payment) => (
                    <tr key={payment.id} className="border-line-200 border-t">
                      <td className="px-3 py-2">
                        {t(`detail.providers.${payment.provider as 'cod'}`)}
                      </td>
                      <td className="px-3 py-2">
                        {t(`detail.paymentKinds.${payment.kind as 'full'}`)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{format.vnd(payment.amount)}</td>
                      <td className="px-3 py-2">
                        {t(`detail.paymentAttempt.${payment.status as 'pending'}`)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {format.dateTime(payment.paidAt ?? payment.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono">{payment.txnRef}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {order.refunds.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-body font-medium">{t('detail.refunds')}</h3>
              <ul className="text-small flex flex-col gap-1">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="flex flex-wrap gap-x-3">
                    <span className="tabular-nums">{format.vnd(refund.amount)}</span>
                    <span>{t(`detail.refundStatus.${refund.status as 'requested'}`)}</span>
                    <span className="text-taupe-600">{format.dateTime(refund.createdAt)}</span>
                    <span className="text-taupe-600">{refund.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section id="order-shipments" title={t('detail.shipments')}>
          {order.shipments.length === 0 ? (
            <p className="text-small text-taupe-600">{t('detail.shipmentsEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-small w-full border-collapse text-left">
                <caption className="sr-only">{t('detail.shipments')}</caption>
                <thead className="bg-sand-100">
                  <tr>
                    {(
                      ['carrier', 'trackingCode', 'status', 'cod', 'fee', 'shippedAt'] as const
                    ).map((key) => (
                      <th key={key} scope="col" className="px-3 py-2 font-medium">
                        {t(`detail.shipmentColumns.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.shipments.map((shipment) => (
                    <tr key={shipment.id} className="border-line-200 border-t">
                      <td className="px-3 py-2">{t(`carrier.${shipment.carrier as 'ghn'}`)}</td>
                      <td className="px-3 py-2 font-mono">{shipment.trackingCode}</td>
                      <td className="px-3 py-2">
                        {t(`shipmentStatus.${shipment.status as 'pending'}`)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{format.vnd(shipment.codAmount)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {shipment.feeActual === null ? '—' : format.vnd(shipment.feeActual)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {shipment.shippedAt ? format.dateTime(shipment.shippedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="order-timeline" title={t('detail.timeline')}>
          <OrderNoteForm orderId={order.id} />
          <OrderTimeline events={order.events} />
        </Section>
      </div>

      <div className="flex flex-col gap-6">
        <Section id="order-actions" title={t('actions.title')}>
          <OrderActions
            order={{ id: order.id, code: order.code, version: order.version, status: order.status }}
            nextStatuses={order.nextStatuses}
            amountPaid={order.amountPaid}
            depositOutstanding={money.depositOutstanding}
            codToCollect={money.codToCollect}
            canCancelPaid={canCancelPaid}
          />
          <div className="border-line-200 flex flex-wrap gap-2 border-t pt-4">
            <Button asChild variant="secondary" size="sm">
              <a
                href={`/admin/orders/${order.id}/print/packing-slip`}
                target="_blank"
                rel="noopener"
              >
                <Printer aria-hidden />
                {t('detail.printPacking')}
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                href={`/admin/orders/${order.id}/print/delivery-slip`}
                target="_blank"
                rel="noopener"
              >
                <Printer aria-hidden />
                {t('detail.printDelivery')}
              </a>
            </Button>
          </div>
        </Section>

        <Section id="order-customer" title={t('detail.customer')}>
          <dl className="text-small flex flex-col gap-1">
            <dt className="sr-only">{t('detail.customer')}</dt>
            <dd className="font-medium">{order.customerName}</dd>
            <dd className="tabular-nums">{order.contact.phone}</dd>
            <dd className="break-all">{order.contact.email}</dd>
            <dd className="text-taupe-600">
              {order.userId ? t('detail.account') : t('detail.guest')} ·{' '}
              {t('detail.emailLocale', { locale: t(`detail.locales.${order.locale}`) })}
            </dd>
          </dl>
          {order.contact.masked && (
            <p className="text-small text-taupe-600">{t('detail.masked')}</p>
          )}
          {order.customerNote && (
            <div className="text-small flex flex-col gap-1">
              <p className="font-medium">{t('detail.customerNote')}</p>
              <p className="whitespace-pre-line">{order.customerNote}</p>
            </div>
          )}
        </Section>

        <Section id="order-address" title={t('detail.shippingAddress')}>
          <Address address={order.shippingAddress} />
          {order.billingAddress && (
            <>
              <h3 className="text-body font-medium">{t('detail.billingAddress')}</h3>
              <Address address={order.billingAddress} />
            </>
          )}
        </Section>

        {(order.giftWrap || order.giftMessage || order.hidePrices) && (
          <Section id="order-gift" title={t('detail.gift')}>
            <ul className="text-small flex flex-col gap-1">
              {order.giftWrap && <li>{t('detail.giftWrap')}</li>}
              {order.hidePrices && <li>{t('detail.hidePrices')}</li>}
            </ul>
            {order.giftMessage && (
              <blockquote className="text-small border-gold-500 border-l-2 pl-3 whitespace-pre-line">
                <span className="sr-only">{t('detail.giftMessage')}: </span>
                {order.giftMessage}
              </blockquote>
            )}
          </Section>
        )}

        <Section id="order-vat" title={t('detail.vat')}>
          {order.vatInvoice ? (
            <dl className="text-small flex flex-col gap-1">
              {order.vatInvoice.companyName && (
                <Row label={t('detail.vatCompany')}>{order.vatInvoice.companyName}</Row>
              )}
              {order.vatInvoice.taxCode && (
                <Row label={t('detail.vatTaxCode')}>{order.vatInvoice.taxCode}</Row>
              )}
              {order.vatInvoice.address && (
                <Row label={t('detail.vatAddress')}>{order.vatInvoice.address}</Row>
              )}
              {order.vatInvoice.email && (
                <Row label={t('detail.vatEmail')}>{order.vatInvoice.email}</Row>
              )}
            </dl>
          ) : (
            <p className="text-small text-taupe-600">{t('detail.vatNone')}</p>
          )}
          {order.einvoiceRef && (
            <p className="text-small">{t('detail.einvoice', { ref: order.einvoiceRef })}</p>
          )}
        </Section>
      </div>
    </div>
  );
}
