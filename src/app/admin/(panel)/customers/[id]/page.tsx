import type { Route } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { CodRiskControl, CustomerNoteForm } from '@/components/admin/customers/customer-actions';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin/orders/order-badges';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Badge } from '@/components/ui/badge';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import {
  canSeeCustomerContact,
  CUSTOMER_ORDER_LIMIT,
  customerPrivacyEmail,
  getCustomerDetail,
  parseCustomerKey,
} from '@/server/modules/customer';

/**
 * One customer (§11.2 "Customers"): profile, addresses, order history, lifetime spend (net of
 * refunds), failed deliveries and the COD risk flag (D16), internal notes, consents and data
 * requests. Guest contacts (orders without an account, grouped by phone) show their orders,
 * spend and failed deliveries; notes and the flag need an account.
 */
export default function AdminCustomerPage(props: PageProps<'/admin/customers/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-small text-taupe-600">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

async function Content({ params }: PageProps<'/admin/customers/[id]'>) {
  const { user } = await requireAdminPage('customers.view');
  const role = user.role ?? 'customer';
  const { id } = await params;
  const key = parseCustomerKey(id);
  if (!key) notFound();
  const db = getDb();
  const customer = await getCustomerDetail(db, key, {
    contactVisible: canSeeCustomerContact(role),
  });
  if (!customer) notFound();
  const canPrivacy = hasPermission(role, 'privacyRequests.handle');
  const privacyEmail = canPrivacy ? await customerPrivacyEmail(db, key) : null;
  const canAudit = hasPermission(role, 'auditLog.view');

  const t = await getTranslations({ locale: 'vi', namespace: 'admin.customers' });
  const tOrders = await getTranslations({ locale: 'vi', namespace: 'admin.orders' });
  const format = await getFormatter({ locale: 'vi' });
  const zone = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
  const dateTime = (value: Date) =>
    format.dateTime(value, { dateStyle: 'short', timeStyle: 'short', ...zone });
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'medium', ...zone });
  const vnd = (amount: number) =>
    format.number(amount, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
  const registered = customer.type === 'registered';
  const name = customer.name || t('noName');

  return (
    <>
      <PageHeader
        title={name}
        meta={
          <span className="flex flex-wrap gap-2">
            <Badge variant="outline">{registered ? t('type.registered') : t('type.guest')}</Badge>
            {customer.codRiskFlag && <Badge variant="warning">{t('risk.flagged')}</Badge>}
            {customer.account?.banned && <Badge variant="neutral">{t('detail.banned')}</Badge>}
          </span>
        }
        back={{ href: '/admin/customers', label: t('back') }}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Section id="customer-profile" title={t('detail.profile')}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('detail.phone')}>
                <span className="tabular-nums">{customer.phone ?? '—'}</span>
              </Field>
              <Field label={t('detail.email')}>
                <span className="break-all">{customer.email ?? '—'}</span>
              </Field>
              <Field label={t('detail.locale')}>{t(`locales.${customer.locale}`)}</Field>
              <Field label={registered ? t('detail.since') : t('detail.firstOrder')}>
                <span className="tabular-nums">{date(customer.since)}</span>
              </Field>
              {customer.account && (
                <>
                  <Field label={t('detail.emailVerified')}>
                    {customer.account.emailVerified ? t('yes') : t('no')}
                  </Field>
                  <Field label={t('detail.lastLogin')}>
                    <span className="tabular-nums">
                      {customer.account.lastLoginAt
                        ? dateTime(customer.account.lastLoginAt)
                        : t('detail.never')}
                    </span>
                  </Field>
                </>
              )}
            </dl>
            {customer.contactMasked && (
              <p className="text-small text-taupe-600">{t('detail.masked')}</p>
            )}
          </Section>

          <Section id="customer-stats" title={t('detail.stats')}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('columns.orders')}>
                <span className="text-h3 tabular-nums">{customer.stats.orderCount}</span>
              </Field>
              <Field label={t('columns.spend')}>
                <span className="text-h3 tabular-nums">{vnd(customer.stats.lifetimeSpend)}</span>
              </Field>
              <Field label={t('columns.lastOrder')}>
                <span className="tabular-nums">
                  {customer.stats.lastOrderAt ? date(customer.stats.lastOrderAt) : '—'}
                </span>
              </Field>
              <Field label={t('detail.failedDeliveries')}>
                <span className="text-h3 tabular-nums">{customer.stats.failedDeliveries}</span>
              </Field>
            </dl>
            <p className="text-small text-taupe-600">{t('detail.spendHint')}</p>
          </Section>

          <Section id="customer-orders" title={t('detail.orders')}>
            {customer.orders.length === 0 ? (
              <p className="text-small text-taupe-600">{t('detail.noOrders')}</p>
            ) : (
              <div className="border-line-200 overflow-x-auto border">
                <table className="text-small w-full border-collapse text-left">
                  <caption className="sr-only">{t('detail.orders')}</caption>
                  <thead className="bg-sand-100">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('orderColumns.code')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('orderColumns.placedAt')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('orderColumns.status')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('orderColumns.payment')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('orderColumns.total')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('orderColumns.refunded')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orders.map((order) => (
                      <tr key={order.id} className="border-line-200 border-t">
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/orders/${order.id}` as Route}
                            prefetch={false}
                            className="font-medium tabular-nums underline-offset-4 hover:underline"
                          >
                            {order.code}
                          </Link>
                          {order.failedDelivery && (
                            <span className="ml-2">
                              <Badge variant="warning">{t('detail.failedDelivery')}</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{dateTime(order.placedAt)}</td>
                        <td className="px-3 py-2">
                          <OrderStatusBadge status={order.status} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <PaymentStatusBadge status={order.paymentStatus} />
                            <span className="text-taupe-600">
                              {tOrders(`paymentMethod.${order.paymentMethod}`)}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{vnd(order.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {order.amountRefunded > 0 ? vnd(order.amountRefunded) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {customer.stats.orderCount > CUSTOMER_ORDER_LIMIT && (
              <p className="text-small text-taupe-600">
                {t('detail.moreOrders', { shown: CUSTOMER_ORDER_LIMIT })}
              </p>
            )}
          </Section>

          {registered && customer.userId && (
            <Section id="customer-notes" title={t('notes.title')}>
              <CustomerNoteForm userId={customer.userId} />
              {customer.history.length === 0 ? (
                <p className="text-small text-taupe-600">{t('notes.empty')}</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {customer.history.map((entry) => (
                    <li
                      key={entry.id}
                      className="border-line-200 flex flex-col gap-1 border-l-2 pl-3"
                    >
                      <p className="text-small text-taupe-600">
                        {t('notes.meta', {
                          actor: entry.actorName ?? t('notes.system'),
                          date: dateTime(entry.createdAt),
                        })}
                      </p>
                      {entry.kind === 'risk' && (
                        <p className="text-small font-medium">
                          {entry.flagged ? t('notes.riskSet') : t('notes.riskCleared')}
                        </p>
                      )}
                      {entry.text && <p className="whitespace-pre-line">{entry.text}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Section id="customer-risk" title={t('detail.risk')}>
            <p className="text-small">
              {customer.codRiskFlag ? t('detail.riskFlagged') : t('detail.riskNotFlagged')}
            </p>
            {customer.phoneFailedDeliveries > 0 && (
              <p className="text-small">
                {t('detail.phoneFailed', { count: customer.phoneFailedDeliveries })}
              </p>
            )}
            {registered && customer.userId ? (
              <CodRiskControl userId={customer.userId} flagged={customer.codRiskFlag} name={name} />
            ) : (
              <p className="text-small text-taupe-600">{t('detail.guestRisk')}</p>
            )}
          </Section>

          {registered && (
            <Section id="customer-addresses" title={t('detail.addresses')}>
              {customer.addresses.length === 0 ? (
                <p className="text-small text-taupe-600">{t('detail.noAddresses')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {customer.addresses.map((address) => (
                    <li key={address.id}>
                      <address className="text-small flex flex-col not-italic">
                        <span className="font-medium">
                          {address.fullName}
                          {address.isDefault && (
                            <span className="ml-2">
                              <Badge variant="gold">{t('detail.defaultAddress')}</Badge>
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums">{address.phone}</span>
                        <span>{address.street}</span>
                        <span>
                          {address.wardName}, {address.provinceName}
                        </span>
                      </address>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section id="customer-consents" title={t('detail.consents')}>
            {customer.consents.length === 0 ? (
              <p className="text-small text-taupe-600">{t('detail.noConsents')}</p>
            ) : (
              <dl className="flex flex-col gap-2">
                {customer.consents.map((consent) => (
                  <div key={consent.purpose} className="text-small flex flex-col">
                    <dt className="font-medium">{t(`purposes.${consent.purpose}`)}</dt>
                    <dd className="text-taupe-600">
                      {t(consent.granted ? 'detail.consentGranted' : 'detail.consentWithdrawn', {
                        date: date(consent.createdAt),
                        version: consent.policyVersion,
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {customer.account && (
              <p className="text-small text-taupe-600">
                {customer.account.marketingOptIn
                  ? t('detail.marketingOn')
                  : t('detail.marketingOff')}
              </p>
            )}
          </Section>

          <Section id="customer-privacy" title={t('detail.privacy')}>
            <p className="text-small">
              {t('detail.privacyCount', { count: customer.privacyRequests })}
            </p>
            {privacyEmail && (
              <Link
                href={
                  `/admin/privacy-requests?filter=all&q=${encodeURIComponent(privacyEmail)}` as Route
                }
                prefetch={false}
                className="text-small text-gold-700 underline-offset-4 hover:underline"
              >
                {t('detail.privacyLink')}
              </Link>
            )}
            {canAudit && customer.userId && (
              <Link
                href={`/admin/audit-log?entityType=user&entityId=${customer.userId}` as Route}
                prefetch={false}
                className="text-small text-gold-700 underline-offset-4 hover:underline"
              >
                {t('detail.auditLink')}
              </Link>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
