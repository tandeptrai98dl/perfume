'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  listManualOrderWardsAction,
  placeManualOrderAction,
  quoteManualOrderAction,
  type PlaceManualOrderData,
} from '@/actions/admin/manual-orders';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import type { ManualOrderQuote } from '@/server/modules/checkout';
import type { AdminUnit, CustomerMatch } from '@/server/modules/customer';

import { useActionFeedback } from '../form/action-feedback';
import { SelectField, SwitchField, TextareaField, TextField } from '../form/fields';
import { OrderStatusBadge } from './order-badges';
import { useOrderFormat } from './format';
import { ManualOrderCustomer } from './manual-order-customer';
import { ManualOrderItems } from './manual-order-items';
import {
  PAYMENT_OPTIONS,
  type LinkProvider,
  type ManualOrderValues,
  type PickedLine,
} from './manual-order-types';

/*
 * ManualOrderForm (§8.4, §11.2 `/admin/orders/new`): customer → items → delivery → coupon →
 * payment → staff note, with a live server-priced summary. On success the form gives way to
 * the result: order code, status and — for online payment or a COD deposit — the payment link
 * to send by Zalo/e-mail.
 */

const DEFAULTS: ManualOrderValues = {
  customer: { fullName: '', phone: '', email: '', locale: 'vi' },
  address: { provinceCode: '', wardCode: '', street: '' },
  shippingRateId: '',
  paymentOption: '',
  linkProvider: 'payos',
  confirmNow: true,
  transfer: { received: false, bankReference: '' },
  staffNote: '',
};

function newCheckoutKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="border-line-200 flex min-w-0 flex-col gap-5 border bg-white p-5">
      <legend className="text-h3 px-1">{legend}</legend>
      {children}
    </fieldset>
  );
}

export function ManualOrderForm({
  checkoutKey: initialKey,
  provinces,
  providers,
  canConfirm,
  canConfirmTransfer,
}: {
  checkoutKey: string;
  provinces: AdminUnit[];
  providers: LinkProvider[];
  canConfirm: boolean;
  canConfirmTransfer: boolean;
}) {
  const t = useTranslations('admin.orders.new');
  const tMethod = useTranslations('admin.orders.paymentMethod');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const [checkoutKey, setCheckoutKey] = useState(initialKey);
  const [match, setMatch] = useState<CustomerMatch | null>(null);
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<ManualOrderQuote | null>(null);
  const [wards, setWards] = useState<Record<string, AdminUnit[]>>({});
  const [result, setResult] = useState<PlaceManualOrderData | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ManualOrderValues>({
    defaultValues: { ...DEFAULTS, linkProvider: providers[0] ?? 'payos' },
  });

  const provinceCode = useWatch({ control: form.control, name: 'address.provinceCode' });
  const shippingRateId = useWatch({ control: form.control, name: 'shippingRateId' });
  const paymentOption = useWatch({ control: form.control, name: 'paymentOption' });
  const linkProvider = useWatch({ control: form.control, name: 'linkProvider' });
  const transferReceived = useWatch({ control: form.control, name: 'transfer.received' });
  const phone = useWatch({ control: form.control, name: 'customer.phone' });
  const email = useWatch({ control: form.control, name: 'customer.email' });

  // ---------- Live summary (debounced; the latest request wins) ----------
  const request = useRef(0);
  const itemsKey = lines.map((line) => `${line.variantId}:${line.quantity}`).join(',');
  useEffect(() => {
    const ticket = ++request.current;
    const timer = setTimeout(async () => {
      const response = await quoteManualOrderAction({
        items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
        provinceCode,
        shippingRateId,
        paymentOption,
        linkProvider,
        couponCode: coupon,
        customer: { ref: match?.ref ?? null, phone, email },
      });
      if (ticket !== request.current || !response.ok) return;
      setQuote(response.data);
      const offered = response.data.shippingRateId ?? '';
      if (offered !== form.getValues('shippingRateId')) {
        form.setValue('shippingRateId', offered, { shouldDirty: true });
      }
    }, 300);
    return () => clearTimeout(timer);
    // `lines` is represented by `itemsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    itemsKey,
    provinceCode,
    shippingRateId,
    paymentOption,
    linkProvider,
    coupon,
    match,
    phone,
    email,
    form,
  ]);

  const quoteLines = useMemo(
    () => new Map((quote?.lines ?? []).map((line) => [line.variantId, line])),
    [quote],
  );

  // ---------- Address ----------
  const provinceOptions = provinces.map((unit) => ({
    value: unit.code,
    label: unit.name,
    keywords: [unit.nameAscii],
  }));
  const wardList = provinceCode ? wards[provinceCode] : undefined;
  const wardOptions = (wardList ?? []).map((unit) => ({
    value: unit.code,
    label: unit.name,
    keywords: [unit.nameAscii],
  }));

  async function changeProvince(code: string | null) {
    form.setValue('address.provinceCode', code ?? '', { shouldDirty: true });
    form.setValue('address.wardCode', '', { shouldDirty: true });
    form.clearErrors(['address.provinceCode', 'address.wardCode']);
    if (code && !wards[code]) {
      const response = await listManualOrderWardsAction({ provinceCode: code });
      if (response.ok) setWards((current) => ({ ...current, [code]: response.data }));
    }
  }

  // ---------- Submit ----------
  function submit(values: ManualOrderValues) {
    setLineErrors({});
    setItemsError(null);
    startTransition(async () => {
      const response = await placeManualOrderAction({
        checkoutKey,
        customer: { ...values.customer, ref: match?.ref ?? null },
        items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
        address: values.address,
        shippingRateId: values.shippingRateId,
        couponCode: coupon,
        paymentOption: values.paymentOption,
        linkProvider: values.linkProvider,
        confirmNow: canConfirm && values.confirmNow,
        transfer: canConfirmTransfer ? values.transfer : { received: false, bankReference: '' },
        staffNote: values.staffNote,
      });
      if (!response.ok) {
        const perLine: Record<string, string> = {};
        const rest = response.fieldErrors.filter((issue) => {
          const [head, variantId] = issue.path.split('.');
          if (head !== 'items') return true;
          if (variantId && /^[0-9a-f-]{36}$/.test(variantId)) perLine[variantId] = issue.code;
          else setItemsError(feedback.message(issue.code));
          return false;
        });
        setLineErrors(perLine);
        feedback.applyFieldErrors(form, { ...response, fieldErrors: rest });
        feedback.fail(response);
        return;
      }
      feedback.success(t('created', { code: response.data.code }));
      setResult(response.data);
    });
  }

  function startOver() {
    form.reset({ ...DEFAULTS, linkProvider: providers[0] ?? 'payos' });
    setLines([]);
    setMatch(null);
    setCoupon('');
    setCouponInput('');
    setQuote(null);
    setResult(null);
    setCheckoutKey(newCheckoutKey());
  }

  if (result) return <ManualOrderResultPanel result={result} onStartOver={startOver} />;

  const totals = quote?.totals;
  const depositRequired = paymentOption === 'cod' ? (totals?.depositRequired ?? 0) : 0;
  const needsLinkProvider =
    paymentOption === 'payment_link' || (paymentOption === 'cod' && depositRequired > 0);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
        aria-label={t('title')}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Section legend={t('sections.customer')}>
            <ManualOrderCustomer match={match} onMatch={setMatch} />
          </Section>

          <Section legend={t('sections.items')}>
            <ManualOrderItems
              lines={lines}
              onChange={(next) => {
                setLines(next);
                setItemsError(null);
              }}
              quoteLines={quoteLines}
              lineErrors={lineErrors}
              error={itemsError}
            />
          </Section>

          <Section legend={t('sections.delivery')}>
            <div className="grid gap-5 md:grid-cols-2">
              <FormField
                control={form.control}
                name="address.provinceCode"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('address.province')}</FormLabel>
                    <FormControl>
                      <Combobox
                        options={provinceOptions}
                        value={field.value || null}
                        onValueChange={(code) => void changeProvince(code)}
                        placeholder={t('address.provincePlaceholder')}
                        invalid={!!fieldState.error}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.wardCode"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('address.ward')}</FormLabel>
                    <FormControl>
                      <Combobox
                        options={wardOptions}
                        value={field.value || null}
                        onValueChange={(code) => {
                          form.setValue('address.wardCode', code ?? '', { shouldDirty: true });
                          form.clearErrors('address.wardCode');
                        }}
                        placeholder={
                          provinceCode ? t('address.wardPlaceholder') : t('address.wardFirst')
                        }
                        disabled={!provinceCode || !wardList}
                        invalid={!!fieldState.error}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <TextField<ManualOrderValues>
                name="address.street"
                label={t('address.street')}
                description={t('address.streetHint')}
                autoComplete="off"
                maxLength={200}
                className="md:col-span-2"
              />
            </div>

            <FormField
              control={form.control}
              name="shippingRateId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('shipping.label')}</FormLabel>
                  {quote && quote.shippingOptions.length > 0 ? (
                    <FormControl>
                      <RadioGroup value={field.value} onValueChange={field.onChange}>
                        {quote.shippingOptions.map((option) => (
                          <RadioCard
                            key={option.rateId}
                            value={option.rateId}
                            title={option.name}
                            description={t('shipping.eta', {
                              min: option.etaMinDays,
                              max: option.etaMaxDays,
                            })}
                            aside={
                              <span className="tabular-nums">
                                {option.fee === 0 ? t('shipping.free') : format.vnd(option.fee)}
                              </span>
                            }
                          />
                        ))}
                      </RadioGroup>
                    </FormControl>
                  ) : (
                    <p className="text-small text-taupe-600">
                      {!provinceCode
                        ? t('shipping.chooseProvince')
                        : lines.length === 0
                          ? t('shipping.addItems')
                          : t('shipping.none')}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section legend={t('sections.coupon')}>
            <CouponField
              value={couponInput}
              onValueChange={setCouponInput}
              applied={coupon}
              onApply={() => setCoupon(couponInput.trim().toUpperCase())}
              onRemove={() => {
                setCoupon('');
                setCouponInput('');
              }}
              status={quote?.coupon ?? null}
            />
          </Section>

          <Section legend={t('sections.payment')}>
            <FormField
              control={form.control}
              name="paymentOption"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('payment.label')}</FormLabel>
                  <FormControl>
                    <RadioGroup value={field.value} onValueChange={field.onChange}>
                      {PAYMENT_OPTIONS.map((option) => (
                        <RadioCard
                          key={option}
                          value={option}
                          disabled={option === 'payment_link' && providers.length === 0}
                          title={t(`payment.options.${option}.title`)}
                          description={t(`payment.options.${option}.description`)}
                        />
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {paymentOption === 'cod' && depositRequired > 0 && (
              <p role="note" className="text-small border-warning border-l-2 pl-3">
                {t('payment.depositNotice', { amount: format.vnd(depositRequired) })}
              </p>
            )}
            {paymentOption === 'cod' && depositRequired === 0 && canConfirm && (
              <SwitchField<ManualOrderValues>
                name="confirmNow"
                label={t('payment.confirmNow')}
                description={t('payment.confirmNowHint')}
              />
            )}
            {needsLinkProvider && providers.length > 0 && (
              <SelectField<ManualOrderValues>
                name="linkProvider"
                label={t('payment.provider')}
                options={providers.map((provider) => ({
                  value: provider,
                  label: tMethod(provider),
                }))}
                className="max-w-sm"
              />
            )}
            {paymentOption === 'bank_transfer' &&
              (canConfirmTransfer ? (
                <>
                  <SwitchField<ManualOrderValues>
                    name="transfer.received"
                    label={t('payment.transferReceived')}
                    description={t('payment.transferReceivedHint')}
                  />
                  {transferReceived && (
                    <TextField<ManualOrderValues>
                      name="transfer.bankReference"
                      label={t('payment.bankReference')}
                      autoComplete="off"
                      maxLength={100}
                      className="max-w-sm"
                    />
                  )}
                </>
              ) : (
                <p role="note" className="text-small text-taupe-600">
                  {t('payment.transferByManager')}
                </p>
              ))}
          </Section>

          <Section legend={t('sections.note')}>
            <TextareaField<ManualOrderValues>
              name="staffNote"
              label={t('staffNote')}
              description={t('staffNoteHint')}
              rows={3}
              maxLength={500}
            />
          </Section>
        </div>

        <aside
          className="border-line-200 flex flex-col gap-4 border bg-white p-5 lg:sticky lg:top-6"
          aria-labelledby="manual-order-summary"
        >
          <h2 id="manual-order-summary" className="text-h3">
            {t('summary.title')}
          </h2>
          <dl className="text-small flex flex-col gap-2" aria-live="polite">
            <SummaryRow label={t('summary.subtotal')} value={format.vnd(totals?.subtotal ?? 0)} />
            {(totals?.discountTotal ?? 0) > 0 && (
              <SummaryRow
                label={t('summary.discount')}
                value={`−${format.vnd(totals!.discountTotal)}`}
              />
            )}
            <SummaryRow
              label={t('summary.shipping')}
              value={
                totals?.shippingFee === null || totals?.shippingFee === undefined
                  ? '—'
                  : totals.shippingFee === 0
                    ? t('shipping.free')
                    : format.vnd(totals.shippingFee)
              }
            />
            <div className="border-line-200 flex justify-between gap-3 border-t pt-2 font-medium">
              <dt>{t('summary.total')}</dt>
              <dd className="tabular-nums" data-testid="manual-order-total">
                {format.vnd(totals?.total ?? 0)}
              </dd>
            </div>
            {depositRequired > 0 && (
              <SummaryRow label={t('summary.deposit')} value={format.vnd(depositRequired)} />
            )}
          </dl>
          <p className="text-small text-taupe-600">{t('summary.serverPriced')}</p>
          <Button type="submit" loading={pending} disabled={lines.length === 0}>
            {t('submit')}
          </Button>
        </aside>
      </form>
    </Form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-taupe-600">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CouponField({
  value,
  onValueChange,
  applied,
  onApply,
  onRemove,
  status,
}: {
  value: string;
  onValueChange: (value: string) => void;
  applied: string;
  onApply: () => void;
  onRemove: () => void;
  status: ManualOrderQuote['coupon'];
}) {
  const t = useTranslations('admin.orders.new.coupon');
  const feedback = useActionFeedback();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="manual-order-coupon" className="text-small font-medium">
        {t('label')}
      </label>
      <div className="flex max-w-md gap-2">
        <Input
          id="manual-order-coupon"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onApply();
            }
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          className="uppercase"
          aria-describedby="manual-order-coupon-status"
        />
        {applied ? (
          <Button type="button" variant="ghost" onClick={onRemove}>
            {t('remove')}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={onApply} disabled={!value.trim()}>
            {t('apply')}
          </Button>
        )}
      </div>
      <p id="manual-order-coupon-status" className="text-small" aria-live="polite">
        {applied && status
          ? status.applied
            ? t('applied', { code: status.code })
            : status.issue
              ? feedback.message(status.issue)
              : null
          : null}
      </p>
    </div>
  );
}

function ManualOrderResultPanel({
  result,
  onStartOver,
}: {
  result: PlaceManualOrderData;
  onStartOver: () => void;
}) {
  const t = useTranslations('admin.orders.new.result');
  const format = useOrderFormat();
  const [copied, setCopied] = useState(false);
  const link = result.link;

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).catch(() => undefined);
    setCopied(true);
  }

  return (
    <section
      className="border-line-200 flex max-w-3xl flex-col gap-5 border bg-white p-6"
      aria-labelledby="manual-order-result"
      data-testid="manual-order-result"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="manual-order-result" className="text-h3">
          {t(result.duplicate ? 'titleDuplicate' : 'title', { code: result.code })}
        </h2>
        <OrderStatusBadge status={result.status} />
      </div>
      <p className="text-small">
        {t('total', { total: format.vnd(result.total) })}
        {result.depositRequired > 0 && result.paymentMethod === 'cod'
          ? ` · ${t('deposit', { amount: format.vnd(result.depositRequired) })}`
          : null}
      </p>
      {link && (
        <div className="flex flex-col gap-2">
          <label htmlFor="manual-order-link" className="text-small font-medium">
            {t('link', { provider: link.provider === 'payos' ? 'VietQR' : 'VNPay' })}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="manual-order-link"
              readOnly
              value={link.url}
              className="min-w-0 flex-1 font-mono"
              onFocus={(event) => event.currentTarget.select()}
              aria-describedby="manual-order-link-hint"
            />
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              {copied ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button asChild variant="ghost">
              <a href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden className="size-4" />
                {t('open')}
              </a>
            </Button>
          </div>
          <p id="manual-order-link-hint" className="text-small text-taupe-600">
            {link.error
              ? t('linkSessionFailed')
              : t('linkHint', {
                  time: link.expiresAt ? format.dateTime(link.expiresAt) : '—',
                })}
          </p>
          {result.linkEmailed && <p className="text-small">{t('linkEmailed')}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`/admin/orders/${result.orderId}` as Route}>{t('view')}</Link>
        </Button>
        <Button type="button" variant="secondary" onClick={onStartOver}>
          {t('another')}
        </Button>
      </div>
    </section>
  );
}
