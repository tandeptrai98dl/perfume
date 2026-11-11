'use client';

import { X } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { saveCouponAction, searchCouponProductsAction } from '@/actions/admin/promotions';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { CouponForEdit, CouponTypeValue } from '@/server/modules/promotion';

import { fromAdminInput, toAdminInput } from '../content/values';
import { useActionFeedback } from '../form/action-feedback';
import {
  CheckboxGroupField,
  NumberField,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from '../form/fields';

const TYPES = ['percent', 'fixed', 'free_shipping'] as const satisfies readonly CouponTypeValue[];

type Named = { id: string; name: string };
type Product = { id: string; name: string; brandName?: string };

type CouponValues = {
  code: string;
  type: CouponTypeValue | null;
  value: number | null;
  maxDiscount: number | null;
  minSubtotal: number | null;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  brandIds: string[];
  categoryIds: string[];
  excludeSaleItems: boolean;
  isActive: boolean;
  note: string;
};

function initialValues(coupon: CouponForEdit | null): CouponValues {
  return {
    code: coupon?.code ?? '',
    type: coupon?.type ?? 'percent',
    value: coupon ? coupon.value : null,
    maxDiscount: coupon?.maxDiscount ?? null,
    minSubtotal: coupon?.minSubtotal ?? null,
    startsAt: toAdminInput(coupon?.startsAt ?? null),
    endsAt: toAdminInput(coupon?.endsAt ?? null),
    usageLimit: coupon?.usageLimit ?? null,
    perCustomerLimit: coupon?.perCustomerLimit ?? null,
    brandIds: coupon?.scope.brandIds ?? [],
    categoryIds: coupon?.scope.categoryIds ?? [],
    excludeSaleItems: coupon?.excludeSaleItems ?? false,
    isActive: coupon?.isActive ?? true,
    note: coupon?.note ?? '',
  };
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="border-line-200 flex flex-col gap-5 border bg-white p-5">
      <legend className="text-h3 px-1">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** CouponForm (§8.4): percent / fixed / free shipping, conditions, scope pickers, limits. */
export function CouponForm({
  coupon,
  brands,
  categories,
}: {
  coupon: CouponForEdit | null;
  brands: Named[];
  categories: (Named & { parentId: string | null })[];
}) {
  const t = useTranslations('admin.coupons');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [products, setProducts] = useState<Product[]>(coupon?.scopeLabels.products ?? []);
  const form = useForm<CouponValues>({ defaultValues: initialValues(coupon) });
  const type = useWatch({ control: form.control, name: 'type' });
  const locked = (coupon?.usedCount ?? 0) > 0;

  function submit(values: CouponValues) {
    startTransition(async () => {
      const result = await saveCouponAction({
        id: coupon?.id ?? null,
        code: values.code,
        type: values.type,
        value: values.type === 'free_shipping' ? 0 : values.value,
        maxDiscount: values.type === 'percent' ? values.maxDiscount : null,
        minSubtotal: values.minSubtotal,
        startsAt: fromAdminInput(values.startsAt),
        endsAt: fromAdminInput(values.endsAt),
        usageLimit: values.usageLimit,
        perCustomerLimit: values.perCustomerLimit,
        scope: {
          brandIds: values.brandIds,
          categoryIds: values.categoryIds,
          productIds: products.map((product) => product.id),
        },
        excludeSaleItems: values.excludeSaleItems,
        isActive: values.isActive,
        note: values.note,
      });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      if (coupon) {
        feedback.success(tForm('saved'));
        form.reset(values);
      } else {
        feedback.success(tForm('created'));
        router.replace(`/admin/promotions/coupons/${result.data.id}` as Route);
      }
    });
  }

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
    indent: category.parentId !== null,
  }));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-6">
        <Fieldset legend={t('form.general')}>
          {locked && (
            <p role="note" className="text-small border-warning border-l-2 pl-3">
              {t('form.usedLocked', { count: coupon!.usedCount })}
            </p>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            <TextField<CouponValues>
              name="code"
              label={t('form.code')}
              description={t('form.codeHint')}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              disabled={locked}
              className="uppercase"
            />
            <SelectField<CouponValues>
              name="type"
              label={t('form.type')}
              options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
              disabled={locked}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <SwitchField<CouponValues> name="isActive" label={t('form.isActive')} />
          </div>
          <TextareaField<CouponValues>
            name="note"
            label={t('form.note')}
            rows={2}
            maxLength={500}
          />
        </Fieldset>

        <Fieldset legend={t('form.valueSection')}>
          {type === 'free_shipping' ? (
            <p className="text-small text-taupe-600">{t('form.freeShippingHint')}</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <NumberField<CouponValues>
                name="value"
                label={t('form.value')}
                description={
                  type === 'percent' ? t('form.valuePercentHint') : t('form.valueFixedHint')
                }
                min={type === 'percent' ? 1 : 0}
                max={type === 'percent' ? 100 : undefined}
              />
              {type === 'percent' && (
                <NumberField<CouponValues>
                  name="maxDiscount"
                  label={t('form.maxDiscount')}
                  description={t('form.limitHint')}
                  min={0}
                />
              )}
            </div>
          )}
        </Fieldset>

        <Fieldset legend={t('form.conditions')}>
          <div className="grid gap-5 md:grid-cols-2">
            <NumberField<CouponValues>
              name="minSubtotal"
              label={t('form.minSubtotal')}
              description={t('form.limitHint')}
              min={0}
            />
            <div />
            <TextField<CouponValues>
              name="startsAt"
              label={t('form.startsAt')}
              description={t('form.datesHint')}
              type="datetime-local"
            />
            <TextField<CouponValues>
              name="endsAt"
              label={t('form.endsAt')}
              description={t('form.datesHint')}
              type="datetime-local"
            />
          </div>
          <SwitchField<CouponValues> name="excludeSaleItems" label={t('form.excludeSaleItems')} />
        </Fieldset>

        <Fieldset legend={t('form.scope')}>
          <p className="text-small text-taupe-600">{t('form.scopeHint')}</p>
          {brands.length > 0 && (
            <CheckboxGroupField<CouponValues>
              name="brandIds"
              label={t('form.brands')}
              options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
            />
          )}
          {categoryOptions.length > 0 && (
            <CheckboxGroupField<CouponValues>
              name="categoryIds"
              label={t('form.categories')}
              options={categoryOptions}
            />
          )}
          <ProductPicker value={products} onChange={setProducts} />
        </Fieldset>

        <Fieldset legend={t('form.limits')}>
          <div className="grid gap-5 md:grid-cols-2">
            <NumberField<CouponValues>
              name="usageLimit"
              label={t('form.usageLimit')}
              description={t('form.limitHint')}
              min={1}
            />
            <NumberField<CouponValues>
              name="perCustomerLimit"
              label={t('form.perCustomerLimit')}
              description={t('form.perCustomerHint')}
              min={1}
            />
          </div>
        </Fieldset>

        <div className="flex gap-3">
          <Button type="submit" loading={pending}>
            {coupon ? tForm('save') : tForm('create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ProductPicker({
  value,
  onChange,
}: {
  value: Product[];
  onChange: (next: Product[]) => void;
}) {
  const t = useTranslations('admin.coupons.form');
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      const result = await searchCouponProductsAction({ q });
      if (result.ok) setResults(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const chosen = new Set(value.map((product) => product.id));
  const shown = query.trim() ? results.filter((product) => !chosen.has(product.id)) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small font-medium" id={`${id}-label`}>
        {t('products')}
      </p>
      {value.length === 0 ? (
        <p className="text-small text-taupe-600">{t('noProducts')}</p>
      ) : (
        <ul aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
          {value.map((product) => (
            <li
              key={product.id}
              className="border-line-200 text-small flex items-center gap-1 border py-1 pr-1 pl-3"
            >
              {product.name}
              <button
                type="button"
                className="hover:bg-sand-100 inline-flex size-8 items-center justify-center"
                aria-label={t('removeProduct', { name: product.name })}
                onClick={() => onChange(value.filter((item) => item.id !== product.id))}
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex max-w-lg flex-col gap-2">
        <label htmlFor={`${id}-search`} className="text-small font-medium">
          {t('productSearch')}
        </label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {shown.length > 0 && (
          <ul className="border-line-200 flex flex-col border">
            {shown.map((product) => (
              <li key={product.id} className="border-line-200 border-b last:border-b-0">
                <button
                  type="button"
                  className="text-small hover:bg-sand-100 flex min-h-11 w-full items-center gap-2 px-3 text-left"
                  aria-label={t('addProduct', { name: product.name })}
                  onClick={() => {
                    onChange([...value, product]);
                    setQuery('');
                    setResults([]);
                  }}
                >
                  <span className="font-medium">{product.name}</span>
                  <span className="text-taupe-600">{product.brandName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
