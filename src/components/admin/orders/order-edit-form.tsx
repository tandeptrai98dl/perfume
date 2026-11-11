'use client';

import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';

import { listWardsAction } from '@/actions/checkout';
import {
  editOrderAction,
  previewOrderEditAction,
  searchOrderEditVariantsAction,
} from '@/actions/admin/order-edits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  EditVariantOption,
  OrderEditForm as OrderEditFormData,
  OrderEditPreview,
} from '@/server/modules/order';

import { useActionFeedback } from '../form/action-feedback';
import { TextField } from '../form/fields';
import { useOrderFormat } from './format';

/*
 * OrderEditForm (§11.2 "Order edits"): shipping address, lines (variant picker with stock, no
 * decants), Manager-only shipping fee override, then a server-computed preview — before/after
 * totals, line diff, coupon outcome and the money consequence — and only then "save". Any
 * change after the preview invalidates it. A concurrent change is refused (optimistic lock).
 */

type Unit = { code: string; name: string; nameAscii: string };

type LineInfo = {
  productName: string;
  variantLabel: string;
  sku: string;
  unitPrice: number;
  available: number;
  /** Quantity the order holds now (0 for a new line): only increases need stock. */
  held: number;
};

type Values = {
  address: {
    fullName: string;
    phone: string;
    provinceCode: string;
    wardCode: string;
    street: string;
  };
  items: { variantId: string; quantity: number }[];
  override: { enabled: boolean; amount: number | null; reason: string };
  note: string;
};

const MAX_QUANTITY = 99;

function useUnitOptions(units: readonly Unit[]): ComboboxOption[] {
  return useMemo(
    () => units.map((unit) => ({ value: unit.code, label: unit.name, keywords: [unit.nameAscii] })),
    [units],
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

export function OrderEditForm({
  form: data,
  canOverrideShipping,
}: {
  form: OrderEditFormData;
  canOverrideShipping: boolean;
}) {
  const t = useTranslations('admin.orders.edit');
  const tOrders = useTranslations('admin.orders');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ key: string; data: OrderEditPreview } | null>(null);
  const [info, setInfo] = useState<Record<string, LineInfo>>(() =>
    Object.fromEntries(
      data.items.map((item) => [
        item.variantId,
        {
          productName: item.productName,
          variantLabel: item.variantLabel,
          sku: item.sku,
          unitPrice: item.unitPrice,
          available: item.available,
          held: item.quantity,
        },
      ]),
    ),
  );

  const form = useForm<Values>({
    defaultValues: {
      address: {
        fullName: data.address?.fullName ?? '',
        phone: data.address?.phone ?? '',
        provinceCode: data.address?.provinceCode ?? '',
        wardCode: data.address?.wardCode ?? '',
        street: data.address?.street ?? '',
      },
      items: data.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
      override: {
        enabled: data.shippingFeeOverride !== null,
        amount: data.shippingFeeOverride,
        reason: '',
      },
      note: '',
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'items', keyName: 'key' });
  const values = useWatch({ control: form.control }) as Values;

  function payload(v: Values) {
    const current = data.shippingFeeOverride;
    const wanted = v.override.enabled ? (v.override.amount ?? 0) : null;
    const overrideChanged = canOverrideShipping && wanted !== current;
    return {
      orderId: data.id,
      expectedVersion: data.version,
      address: v.address,
      items: v.items.map((item) => ({
        variantId: item.variantId,
        quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
      })),
      shippingFeeOverride: overrideChanged ? { amount: wanted, reason: v.override.reason } : null,
      note: v.note.trim() || null,
    };
  }
  const currentKey = JSON.stringify(payload(values));
  const fresh = preview && preview.key === currentKey ? preview.data : null;
  const canSave = !!fresh && fresh.changed && fresh.issues.length === 0;

  function runPreview() {
    const body = payload(form.getValues());
    const key = JSON.stringify(body);
    form.clearErrors();
    startTransition(async () => {
      const result = await previewOrderEditAction(body);
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        setPreview(null);
        return;
      }
      feedback.applyFieldErrors(form, {
        ok: false,
        error: 'invalid',
        fieldErrors: result.data.issues,
      });
      setPreview({ key, data: result.data });
    });
  }

  function save() {
    const body = payload(form.getValues());
    startTransition(async () => {
      const result = await editOrderAction(body);
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('saved', { code: data.code }));
      router.push(`/admin/orders/${data.id}` as Route);
    });
  }

  function addVariant(option: EditVariantOption) {
    const index = values.items.findIndex((item) => item.variantId === option.variantId);
    if (index >= 0) {
      const quantity = (values.items[index]?.quantity ?? 0) + 1;
      form.setValue(`items.${index}.quantity`, Math.min(quantity, MAX_QUANTITY), {
        shouldDirty: true,
      });
      return;
    }
    setInfo((current) => ({
      ...current,
      [option.variantId]: current[option.variantId] ?? {
        productName: option.productName,
        variantLabel: option.variantLabel,
        sku: option.sku,
        unitPrice: option.price,
        available: option.available,
        held: 0,
      },
    }));
    lines.append({ variantId: option.variantId, quantity: 1 });
  }

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"
        onSubmit={(event) => {
          event.preventDefault();
          runPreview();
        }}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="edit-items" title={t('items')}>
            <ItemsTable
              form={form}
              fields={lines.fields}
              info={info}
              onRemove={(index) => lines.remove(index)}
            />
            <VariantPicker orderId={data.id} onPick={addVariant} />
          </Section>

          <Section id="edit-address" title={t('address')}>
            <AddressFields form={form} provinces={data.provinces} initialWards={data.wards} />
          </Section>

          <Section id="edit-shipping" title={t('shipping')}>
            <ShippingOverride
              form={form}
              canOverride={canOverrideShipping}
              current={data.shippingFeeOverride}
              currentFee={data.shippingFee}
            />
          </Section>

          <Section id="edit-note" title={t('noteTitle')}>
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('note')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} maxLength={500} />
                  </FormControl>
                  <FormDescription>{t('noteHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <Section id="edit-preview" title={t('preview.title')}>
            <p className="text-small text-taupe-600">{t('preview.hint')}</p>
            <Button type="submit" variant="secondary" loading={pending && !fresh}>
              {t('preview.run')}
            </Button>
            <div aria-live="polite" className="flex flex-col gap-4">
              {preview && !fresh && <p className="text-small text-warning">{t('preview.stale')}</p>}
              {fresh && <PreviewPanel preview={fresh} />}
            </div>
            <Button type="button" disabled={!canSave} loading={pending && !!fresh} onClick={save}>
              {t('save')}
            </Button>
            <p className="text-small text-taupe-600">
              {t('current', {
                total: format.vnd(data.total),
                paid: format.vnd(data.amountPaid),
                status: tOrders(`paymentStatus.${data.paymentStatus}`),
              })}
            </p>
          </Section>
        </div>
      </form>
    </Form>
  );
}

function ItemsTable({
  form,
  fields,
  info,
  onRemove,
}: {
  form: UseFormReturn<Values>;
  fields: { key: string; variantId: string }[];
  info: Record<string, LineInfo>;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations('admin.orders.edit');
  const format = useOrderFormat();
  const items = useWatch({ control: form.control, name: 'items' });

  if (fields.length === 0) {
    return <p className="text-small text-danger">{t('noItems')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full border-collapse text-left">
        <caption className="sr-only">{t('items')}</caption>
        <thead className="bg-sand-100">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('columns.product')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('columns.unitPrice')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('columns.quantity')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('columns.lineTotal')}
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">{t('columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, index) => {
            const line = info[field.variantId];
            const quantity = items[index]?.quantity ?? 0;
            const name = line ? `${line.productName} · ${line.variantLabel}` : field.variantId;
            const short = line ? Math.max(0, quantity - line.held) > line.available : false;
            return (
              <tr key={field.key} className="border-line-200 border-t align-top">
                <td className="px-3 py-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{line?.productName}</span>
                    <span className="text-taupe-600">
                      {line?.variantLabel} · <span className="font-mono">{line?.sku}</span>
                    </span>
                    <span className={short ? 'text-danger' : 'text-taupe-600'}>
                      {line?.held
                        ? t('heldAndAvailable', { held: line.held, available: line.available })
                        : t('available', { available: line?.available ?? 0 })}
                    </span>
                    {line?.held === 0 && <span className="text-gold-700">{t('newLine')}</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {line ? format.vnd(line.unitPrice) : '—'}
                </td>
                <td className="px-3 py-2">
                  <QuantityInput form={form} index={index} label={t('quantityFor', { name })} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {line ? format.vnd(line.unitPrice * (quantity || 0)) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('remove', { name })}
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuantityInput({
  form,
  index,
  label,
}: {
  form: UseFormReturn<Values>;
  index: number;
  label: string;
}) {
  const t = useTranslations('admin.orders.edit');
  return (
    <FormField
      control={form.control}
      name={`items.${index}.quantity`}
      render={({ field }) => (
        <FormItem className="gap-1">
          <FormLabel className="sr-only">{label}</FormLabel>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
              aria-label={t('decrease', { name: label })}
              disabled={(field.value ?? 1) <= 1}
              onClick={() => field.onChange(Math.max(1, (field.value ?? 1) - 1))}
            >
              <Minus aria-hidden />
            </Button>
            <FormControl>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_QUANTITY}
                className="w-16 text-center tabular-nums"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={Number.isFinite(field.value) ? field.value : ''}
                onChange={(event) => field.onChange(event.target.valueAsNumber)}
              />
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
              aria-label={t('increase', { name: label })}
              disabled={(field.value ?? 0) >= MAX_QUANTITY}
              onClick={() => field.onChange(Math.min(MAX_QUANTITY, (field.value ?? 0) + 1))}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function VariantPicker({
  orderId,
  onPick,
}: {
  orderId: string;
  onPick: (option: EditVariantOption) => void;
}) {
  const t = useTranslations('admin.orders.edit');
  const format = useOrderFormat();
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EditVariantOption[] | null>(null);
  const [searching, startSearch] = useTransition();
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = setTimeout(() => {
      latest.current = q;
      startSearch(async () => {
        const result = await searchOrderEditVariantsAction({ orderId, q });
        if (latest.current !== q) return;
        setResults(result.ok ? result.data : []);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [orderId, query]);

  return (
    <div className="border-line-200 flex flex-col gap-3 border-t pt-4">
      <Label htmlFor={`${id}-search`}>{t('picker.label')}</Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-taupe-600"
        />
        <Input
          id={`${id}-search`}
          type="search"
          className="pl-9"
          value={query}
          placeholder={t('picker.placeholder')}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < 2) setResults(null);
          }}
        />
      </div>
      <p id={`${id}-hint`} className="text-small text-taupe-600">
        {t('picker.hint')}
      </p>
      <div aria-live="polite" aria-busy={searching}>
        {results && results.length === 0 && (
          <p className="text-small text-taupe-600">{t('picker.empty')}</p>
        )}
        {results && results.length > 0 && (
          <ul className="flex flex-col" aria-label={t('picker.results')}>
            {results.map((option) => (
              <li
                key={option.variantId}
                className="border-line-200 flex flex-wrap items-center justify-between gap-3 border-t py-2 first:border-t-0"
              >
                <span className="text-small flex min-w-0 flex-col">
                  <span className="font-medium">
                    {option.brandName} · {option.productName}
                  </span>
                  <span className="text-taupe-600">
                    {option.variantLabel} · <span className="font-mono">{option.sku}</span> ·{' '}
                    {format.vnd(option.price)} · {t('available', { available: option.available })}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={option.available <= 0}
                  aria-label={t('picker.addLabel', {
                    name: `${option.productName} ${option.variantLabel}`,
                  })}
                  onClick={() => onPick(option)}
                >
                  {option.available <= 0 ? t('picker.soldOut') : t('picker.add')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddressFields({
  form,
  provinces,
  initialWards,
}: {
  form: UseFormReturn<Values>;
  provinces: Unit[];
  initialWards: Unit[];
}) {
  const t = useTranslations('admin.orders.edit');
  const provinceCode = useWatch({ control: form.control, name: 'address.provinceCode' });
  const [wards, setWards] = useState<Record<string, Unit[]>>(() =>
    provinceCode ? { [provinceCode]: initialWards } : {},
  );
  const [loading, setLoading] = useState(false);
  const provinceOptions = useUnitOptions(provinces);
  const wardOptions = useUnitOptions(wards[provinceCode] ?? []);

  async function changeProvince(code: string | null) {
    form.setValue('address.provinceCode', code ?? '', { shouldDirty: true });
    form.setValue('address.wardCode', '', { shouldDirty: true });
    if (code && !wards[code]) {
      setLoading(true);
      const result = await listWardsAction({ provinceCode: code });
      if (result.ok) setWards((current) => ({ ...current, [code]: result.wards }));
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <TextField<Values>
        name="address.fullName"
        label={t('fullName')}
        autoComplete="off"
        maxLength={100}
      />
      <TextField<Values>
        name="address.phone"
        label={t('phone')}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        maxLength={15}
      />
      <FormField
        control={form.control}
        name="address.provinceCode"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('province')}</FormLabel>
            <FormControl>
              <Combobox
                options={provinceOptions}
                value={field.value || null}
                onValueChange={(code) => void changeProvince(code)}
                placeholder={t('provincePlaceholder')}
                searchPlaceholder={t('search')}
                emptyText={t('noResults')}
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
            <FormLabel>{t('ward')}</FormLabel>
            <FormControl>
              <Combobox
                options={wardOptions}
                value={field.value || null}
                onValueChange={(code) =>
                  form.setValue('address.wardCode', code ?? '', { shouldDirty: true })
                }
                placeholder={loading ? t('wardLoading') : t('wardPlaceholder')}
                searchPlaceholder={t('search')}
                emptyText={t('noResults')}
                disabled={!provinceCode || loading}
                invalid={!!fieldState.error}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <TextField<Values>
        name="address.street"
        label={t('street')}
        className="md:col-span-2"
        autoComplete="off"
        maxLength={200}
      />
    </div>
  );
}

function ShippingOverride({
  form,
  canOverride,
  current,
  currentFee,
}: {
  form: UseFormReturn<Values>;
  canOverride: boolean;
  current: number | null;
  currentFee: number;
}) {
  const t = useTranslations('admin.orders.edit');
  const format = useOrderFormat();
  const enabled = useWatch({ control: form.control, name: 'override.enabled' });
  if (!canOverride) {
    return (
      <p className="text-small text-taupe-600">
        {current !== null
          ? t('overrideActive', { amount: format.vnd(current) })
          : t('overrideManagerOnly', { amount: format.vnd(currentFee) })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <FormField
        control={form.control}
        name="override.enabled"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center gap-3">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </FormControl>
            <FormLabel>{t('overrideEnable')}</FormLabel>
          </FormItem>
        )}
      />
      {enabled && (
        <FormField
          control={form.control}
          name="override.amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('overrideAmount')}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1000}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(
                      Number.isFinite(event.target.valueAsNumber)
                        ? event.target.valueAsNumber
                        : null,
                    )
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="override.reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('overrideReason')}</FormLabel>
            <FormControl>
              <Input {...field} maxLength={500} autoComplete="off" />
            </FormControl>
            <FormDescription>{t('overrideReasonHint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

type TotalKey = keyof OrderEditPreview['before'];
const TOTAL_ROWS: TotalKey[] = [
  'subtotal',
  'discountTotal',
  'shippingFee',
  'giftWrapFee',
  'total',
  'depositRequired',
];

function PreviewPanel({ preview }: { preview: OrderEditPreview }) {
  const t = useTranslations('admin.orders.edit');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const { payment } = preview;

  if (!preview.changed) {
    return <p className="text-small">{t('preview.noChange')}</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="order-edit-preview">
      {preview.issues.length > 0 && (
        <div role="alert">
          <ul className="text-small text-danger flex list-disc flex-col gap-1 pl-5">
            {preview.issues.map((issue) => (
              <li key={`${issue.path}:${issue.code}`}>{feedback.message(issue.code)}</li>
            ))}
          </ul>
        </div>
      )}
      <table className="text-small w-full border-collapse text-left">
        <caption className="sr-only">{t('preview.totals')}</caption>
        <thead>
          <tr className="text-taupe-600">
            <th scope="col" className="py-1 font-normal">
              <span className="sr-only">{t('preview.amount')}</span>
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              {t('preview.before')}
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              {t('preview.after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {TOTAL_ROWS.filter((key) => preview.before[key] !== 0 || preview.after[key] !== 0).map(
            (key) => (
              <tr
                key={key}
                className={key === 'total' ? 'border-line-200 border-t font-medium' : undefined}
              >
                <th scope="row" className="py-1 font-normal">
                  {t(`preview.rows.${key}`)}
                </th>
                <td className="py-1 text-right tabular-nums">{format.vnd(preview.before[key])}</td>
                <td
                  className={
                    preview.before[key] !== preview.after[key]
                      ? 'py-1 text-right font-medium tabular-nums'
                      : 'py-1 text-right tabular-nums'
                  }
                >
                  {format.vnd(preview.after[key])}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {preview.lineDiff.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-body font-medium">{t('preview.lines')}</h3>
          <ul className="text-small flex flex-col gap-1">
            {preview.lineDiff.map((line) => (
              <li key={line.variantId}>
                {line.from === null
                  ? t('preview.added', {
                      name: `${line.productName} ${line.variantLabel}`,
                      to: line.to ?? 0,
                    })
                  : line.to === null
                    ? t('preview.removed', { name: `${line.productName} ${line.variantLabel}` })
                    : t('preview.changedQty', {
                        name: `${line.productName} ${line.variantLabel}`,
                        from: line.from,
                        to: line.to,
                      })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.addressFields.length > 0 && (
        <p className="text-small">
          {t('preview.address', {
            fields: preview.addressFields
              .filter((field) => field !== 'provinceName' && field !== 'wardName')
              .map((field) => t(`preview.addressFields.${field}`))
              .join(', '),
          })}
        </p>
      )}
      {preview.coupon && !preview.coupon.kept && (
        <p className="text-small text-warning" role="note">
          {t('preview.couponDropped', { code: preview.coupon.code })}
        </p>
      )}
      {preview.shipping.override !== null && (
        <p className="text-small">
          {t('preview.override', { amount: format.vnd(preview.shipping.override) })}
        </p>
      )}
      <p
        className="text-small border-gold-500 border-l-2 pl-3 font-medium"
        data-testid="edit-money"
      >
        {payment.refund > 0
          ? t('preview.refund', { amount: format.vnd(payment.refund) })
          : payment.onlineDue > 0 && payment.amountPaid > 0
            ? t('preview.payDifference', { amount: format.vnd(payment.onlineDue) })
            : payment.onlineDue > 0
              ? t('preview.dueOnline', { amount: format.vnd(payment.onlineDue) })
              : payment.difference === 0
                ? t('preview.sameTotal')
                : t('preview.difference', {
                    amount: format.vnd(Math.abs(payment.difference)),
                    direction: payment.difference > 0 ? 'up' : 'down',
                  })}
      </p>
    </div>
  );
}
