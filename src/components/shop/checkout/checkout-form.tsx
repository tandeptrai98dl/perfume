'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form';

import { placeOrderAction, quoteCheckoutAction, type CheckoutFailure } from '@/actions/checkout';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import {
  CHECKOUT_LIMITS,
  checkoutFormSchema,
  type CheckoutFormValues,
} from '@/lib/checkout/form-schema';

import { AddressForm, useWardDirectory } from './address-form';
import { CheckoutSection } from './checkout-section';
import { ConsentCheckboxes } from './consent-checkboxes';
import { ContactSection } from './contact-section';
import { CheckoutFieldMessage, useCheckoutErrorMessage } from './field-message';
import { OrderReview, type CouponControls } from './order-review';
import { DepositNotice, PaymentMethodPicker } from './payment-method-picker';
import { PlaceOrderButton } from './place-order-button';
import { NEW_ADDRESS, SavedAddressPicker } from './saved-address-picker';
import { ShippingMethodPicker } from './shipping-method-picker';
import type { CheckoutPageData, CheckoutQuote } from './types';
import { VatInvoiceFields } from './vat-invoice-fields';

/*
 * One-page checkout (§10.4): contact → address → delivery → payment, with the order summary,
 * coupon, consents and the place-order button beside it. React Hook Form + the shared Zod
 * schema validate on the client; the Server Action validates again and maps its errors back to
 * the same field paths. Totals always come from the server (`quoteCheckoutAction`).
 */

type Alert =
  | { kind: 'fixErrors' | 'priceChanged' | 'rateLimited' | 'unexpected' | 'quoteFailed' }
  | { kind: 'cartChanged'; items: { variantId: string; code: string }[] };

const FORM_PATHS = new Set<string>([
  'email',
  'phone',
  'fullName',
  'address.provinceCode',
  'address.wardCode',
  'address.street',
  'shippingRateId',
  'paymentMethod',
  'customerNote',
  'vatInvoice.companyName',
  'vatInvoice.taxCode',
  'vatInvoice.email',
  'vatInvoice.address.provinceCode',
  'vatInvoice.address.wardCode',
  'vatInvoice.address.street',
  'consents.terms',
  'consents.privacy',
]);

export function CheckoutForm({ data }: { data: CheckoutPageData }) {
  const t = useTranslations('checkout');
  const errorMessage = useCheckoutErrorMessage();
  const wards = useWardDirectory(data.initialWards);
  // The schema's output (normalized phone, VAT details or null) is what the server uses; the
  // client only needs its verdict and sends the raw values.
  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema) as unknown as Resolver<CheckoutFormValues>,
    mode: 'onTouched',
    defaultValues: {
      locale: data.locale,
      checkoutKey: data.checkoutKey,
      email: data.defaults.email,
      phone: data.defaults.phone,
      fullName: data.defaults.fullName,
      address: data.defaults.address,
      shippingRateId: data.quote.shippingRateId ?? '',
      paymentMethod: '',
      couponCode: data.quote.coupon?.applied ? data.quote.coupon.code : '',
      customerNote: '',
      vatInvoice: {
        requested: false,
        companyName: '',
        taxCode: '',
        email: '',
        address: { provinceCode: '', wardCode: '', street: '' },
      },
      consents: { terms: false, privacy: false, marketing: false },
    },
  });

  const [quote, setQuote] = useState<CheckoutQuote>(data.quote);
  const [quoting, startQuote] = useTransition();
  const [couponPending, setCouponPending] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(
    data.quote.coupon && !data.quote.coupon.applied ? data.quote.coupon.issue : null,
  );
  const [alert, setAlert] = useState<Alert | null>(null);
  const [savedId, setSavedId] = useState(data.defaults.savedAddressId ?? NEW_ADDRESS);
  const [placing, setPlacing] = useState(false);
  const submitLock = useRef(false);
  const quoteSeq = useRef(0);

  const [provinceCode, shippingRateId, paymentMethod, couponCode] = useWatch({
    control: form.control,
    name: ['address.provinceCode', 'shippingRateId', 'paymentMethod', 'couponCode'],
  });

  const requestQuote = useCallback(
    async (couponOverride?: string) => {
      const values = form.getValues();
      const seq = ++quoteSeq.current;
      const result = await quoteCheckoutAction({
        locale: data.locale,
        provinceCode: values.address.provinceCode,
        shippingRateId: values.shippingRateId,
        paymentMethod: values.paymentMethod,
        couponCode: couponOverride ?? values.couponCode ?? '',
        email: values.email,
        phone: values.phone,
      });
      if (seq !== quoteSeq.current) return null;
      if (!result.ok) {
        setAlert(
          result.error === 'cartUnavailable'
            ? { kind: 'cartChanged', items: [] }
            : { kind: 'quoteFailed' },
        );
        return null;
      }
      const next = result.quote;
      setQuote(next);
      const nextRate = next.shippingRateId ?? '';
      if (nextRate !== values.shippingRateId) {
        form.setValue('shippingRateId', nextRate, { shouldValidate: form.formState.isSubmitted });
      }
      return next;
    },
    [data.locale, form],
  );

  // Re-quote when anything that changes the price changes (province → rates, rate, method).
  const lastQuoted = useRef(
    JSON.stringify([
      data.defaults.address.provinceCode,
      data.quote.shippingRateId ?? '',
      '',
      data.quote.coupon?.applied ? data.quote.coupon.code : '',
    ]),
  );
  useEffect(() => {
    const key = JSON.stringify([provinceCode, shippingRateId, paymentMethod, couponCode ?? '']);
    if (key === lastQuoted.current) return;
    lastQuoted.current = key;
    startQuote(async () => {
      const next = await requestQuote();
      if (next) {
        lastQuoted.current = JSON.stringify([
          provinceCode,
          next.shippingRateId ?? '',
          paymentMethod,
          couponCode ?? '',
        ]);
      }
    });
  }, [provinceCode, shippingRateId, paymentMethod, couponCode, requestQuote]);

  const couponControls: CouponControls = {
    pending: couponPending,
    error: couponError,
    apply: (code) => {
      setCouponPending(true);
      setCouponError(null);
      void requestQuote(code).then((next) => {
        setCouponPending(false);
        if (!next) return;
        if (next.coupon?.applied) {
          lastQuoted.current = JSON.stringify([
            form.getValues('address.provinceCode'),
            next.shippingRateId ?? '',
            form.getValues('paymentMethod'),
            next.coupon.code,
          ]);
          form.setValue('couponCode', next.coupon.code);
        } else {
          setCouponError(next.coupon?.issue ?? 'couponNotFound');
        }
      });
    },
    remove: () => {
      setCouponError(null);
      form.setValue('couponCode', '');
    },
  };

  function selectSaved(id: string) {
    setSavedId(id);
    const address = data.savedAddresses.find((entry) => entry.id === id);
    if (!address) return;
    void wards.load(address.provinceCode);
    form.setValue('fullName', address.fullName, { shouldDirty: true });
    if (!form.getValues('phone')) form.setValue('phone', address.phone, { shouldDirty: true });
    form.setValue(
      'address',
      { provinceCode: address.provinceCode, wardCode: address.wardCode, street: address.street },
      { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
    );
  }

  function applyFailure(failure: CheckoutFailure) {
    const items: { variantId: string; code: string }[] = [];
    let next: Alert = { kind: failure.error === 'rateLimited' ? 'rateLimited' : 'unexpected' };
    let firstField: string | null = null;
    let refresh = false;

    for (const issue of failure.fieldErrors) {
      if (issue.path === 'total') {
        next = { kind: 'priceChanged' };
        refresh = true;
      } else if (issue.path.startsWith('items.')) {
        items.push({ variantId: issue.path.slice('items.'.length), code: issue.code });
      } else if (issue.path === 'cart') {
        items.push({ variantId: '', code: issue.code });
      } else if (issue.path === 'couponCode') {
        setCouponError(issue.code);
        form.setValue('couponCode', '');
        next = { kind: 'fixErrors' };
      } else if (FORM_PATHS.has(issue.path)) {
        const path = issue.path as FieldPath<CheckoutFormValues>;
        form.setError(path, { type: 'server', message: issue.code });
        firstField ??= path;
        next = { kind: 'fixErrors' };
        if (issue.path === 'shippingRateId') refresh = true;
      }
    }
    if (items.length > 0) {
      next = { kind: 'cartChanged', items };
      refresh = true;
    }
    setAlert(next);
    if (refresh) startQuote(async () => void (await requestQuote()));
    if (firstField) form.setFocus(firstField as FieldPath<CheckoutFormValues>);
  }

  async function placeOrder() {
    if (submitLock.current) return;
    submitLock.current = true;
    setPlacing(true);
    setAlert(null);
    let failure: CheckoutFailure | undefined;
    try {
      // Raw values: the action parses them with the same schema. No prices are sent; the
      // displayed total is only compared so a price change is never charged silently.
      const result = await placeOrderAction({
        ...form.getValues(),
        expectedTotal: quote.totals.total,
      });
      // VNPay: leave for the gateway (external page); the button stays locked meanwhile.
      if (result?.ok) {
        window.location.assign(result.gatewayUrl);
        return;
      }
      failure = result;
    } catch {
      failure = { ok: false, error: 'unexpected', fieldErrors: [] };
    }
    // On success the action redirects to the result page and the button stays locked.
    if (failure) {
      submitLock.current = false;
      setPlacing(false);
      applyFailure(failure);
    }
  }

  const freeShippingCoupon = quote.totals.shippingFee === 0 && quote.coupon?.applied === true;
  const merchandise = quote.totals.subtotal - quote.totals.discountTotal;
  const paysOnline =
    paymentMethod === 'payos' ||
    paymentMethod === 'vnpay' ||
    (paymentMethod === 'cod' && quote.totals.depositRequired > 0);

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit(placeOrder, () => setAlert({ kind: 'fixErrors' }))(event)
        }
        aria-busy={placing}
        className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16"
      >
        <div className="flex flex-col gap-10">
          <CheckoutSection
            step={1}
            title={t('steps.contact')}
            aside={
              data.signedIn ? null : (
                <p className="text-small text-taupe-600">
                  {t('contact.signInPrompt')}{' '}
                  <a
                    href={data.links.signIn}
                    className="text-gold-700 underline underline-offset-4"
                  >
                    {t('contact.signIn')}
                  </a>
                </p>
              )
            }
          >
            <ContactSection />
          </CheckoutSection>

          <CheckoutSection step={2} title={t('steps.address')}>
            <SavedAddressPicker
              addresses={data.savedAddresses}
              value={savedId}
              onValueChange={selectSaved}
            />
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('address.fullName')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="shipping name" required />
                  </FormControl>
                  <CheckoutFieldMessage />
                </FormItem>
              )}
            />
            <AddressForm prefix="address" provinces={data.provinces} wards={wards} />
            <FormField
              control={form.control}
              name="customerNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('address.note')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} maxLength={CHECKOUT_LIMITS.note} />
                  </FormControl>
                  <FormDescription>{t('address.noteHint')}</FormDescription>
                  <CheckoutFieldMessage />
                </FormItem>
              )}
            />
          </CheckoutSection>

          <CheckoutSection step={3} title={t('steps.shipping')}>
            <ShippingMethodPicker
              options={quote.shippingOptions}
              provinceChosen={!!provinceCode}
              merchandiseTotal={merchandise}
              freeShippingCoupon={freeShippingCoupon}
              label={t('steps.shipping')}
            />
          </CheckoutSection>

          <CheckoutSection step={4} title={t('steps.payment')}>
            <PaymentMethodPicker label={t('steps.payment')} />
            {paymentMethod === 'cod' && quote.totals.depositRequired > 0 && (
              <DepositNotice
                total={quote.totals.total}
                deposit={quote.totals.depositRequired}
                threshold={quote.cod.maxOrderWithoutDeposit}
                percent={quote.cod.depositPercent}
              />
            )}
            <VatInvoiceFields provinces={data.provinces} wards={wards} />
          </CheckoutSection>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <div className="bg-ivory-50 border-line-200 border p-5 md:p-6">
            <OrderReview
              quote={quote}
              updating={quoting}
              coupon={couponControls}
              showDeposit={paymentMethod === 'cod'}
            />
          </div>
          <ConsentCheckboxes termsHref={data.links.terms} privacyHref={data.links.privacy} />
          <div aria-live="assertive" className="empty:hidden" data-testid="checkout-alert">
            {alert && (
              <div role="alert" className="border-danger text-small border-l-2 bg-white p-4">
                <p className="font-medium">{t(`alerts.${alert.kind}`)}</p>
                {alert.kind === 'cartChanged' && (
                  <>
                    <ul className="mt-2 list-disc pl-5">
                      {alert.items.map((item) => {
                        const line = quote.lines.find(
                          (entry) => entry.variantId === item.variantId,
                        );
                        return (
                          <li key={`${item.variantId}:${item.code}`}>
                            {errorMessage(item.code, { name: line?.productName ?? '' })}
                          </li>
                        );
                      })}
                    </ul>
                    <Link href="/cart" className="text-gold-700 mt-2 inline-block underline">
                      {t('backToCart')}
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
          <PlaceOrderButton placing={placing} paysOnline={paysOnline} waiting={quoting} />
        </aside>
      </form>
    </Form>
  );
}
