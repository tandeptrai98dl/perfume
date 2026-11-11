'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import {
  deleteShippingRateAction,
  deleteShippingZoneAction,
  saveShippingRateAction,
  saveShippingZoneAction,
  setShippingRateActiveAction,
} from '@/actions/admin/shipping';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import type {
  AdminShippingRate,
  AdminShippingZone,
  ProvinceOption,
} from '@/server/modules/shipping';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';
import { CheckboxGroupField, NumberField, SwitchField, TextField } from '../form/fields';
import { useOrderFormat } from '../orders/format';

/* /admin/shipping (§11.2): zones (province groups) with weight-band rates, vi/en names. */

export function ShippingManager({
  zones,
  provinces,
}: {
  zones: AdminShippingZone[];
  provinces: ProvinceOption[];
}) {
  const t = useTranslations('admin.shipping');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-taupe-600">{t('firstZoneWins')}</p>
        <ZoneDialog
          provinces={provinces}
          zone={null}
          trigger={
            <Button>
              <Plus aria-hidden />
              {t('zone.new')}
            </Button>
          }
        />
      </div>
      {zones.length === 0 && (
        <p role="note" className="border-warning text-small border-l-2 pl-3">
          {t('empty')}
        </p>
      )}
      {zones.map((zone) => (
        <ZoneCard key={zone.id} zone={zone} provinces={provinces} />
      ))}
    </div>
  );
}

function ZoneCard({ zone, provinces }: { zone: AdminShippingZone; provinces: ProvinceOption[] }) {
  const t = useTranslations('admin.shipping');
  const feedback = useActionFeedback();
  const names = provinces
    .filter((province) => zone.provinceCodes.includes(province.code))
    .map((province) => province.name);
  const headingId = `zone-${zone.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="border-line-200 flex flex-col gap-4 border bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-h3">
            {zone.name}
          </h2>
          <p className="text-small text-taupe-600">
            {t('zone.position')}: {zone.position} ·{' '}
            {t('zone.provinceCount', { count: zone.provinceCodes.length })}
          </p>
          <details className="text-small">
            <summary className="cursor-pointer">{t('zone.provinces')}</summary>
            <p className="mt-2">{names.join(', ')}</p>
          </details>
        </div>
        <div className="flex flex-wrap gap-2">
          <ZoneDialog
            zone={zone}
            provinces={provinces}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('zone.editFor', { name: zone.name })}
              >
                <Pencil aria-hidden />
                {t('zone.edit')}
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-danger">
                <Trash2 aria-hidden />
                {t('zone.delete')}
              </Button>
            }
            title={t('zone.deleteTitle', { name: zone.name })}
            description={t('zone.deleteDescription')}
            confirmLabel={t('zone.delete')}
            confirmText={zone.name}
            onConfirm={async () => {
              const result = await deleteShippingZoneAction({ id: zone.id });
              if (!result.ok) {
                feedback.fail(result);
                return false;
              }
              feedback.success(t('zone.deleted'));
            }}
          />
        </div>
      </div>
      <RatesTable zone={zone} />
    </section>
  );
}

function RatesTable({ zone }: { zone: AdminShippingZone }) {
  const t = useTranslations('admin.shipping.rate');
  const format = useOrderFormat();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-medium">{t('title')}</h3>
        <RateDialog
          zoneId={zone.id}
          rate={null}
          trigger={
            <Button variant="secondary" size="sm" aria-label={t('newFor', { zone: zone.name })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          }
        />
      </div>
      {zone.rates.length === 0 ? (
        <p className="text-small text-taupe-600">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-small w-full border-collapse text-left">
            <caption className="sr-only">
              {t('title')} · {zone.name}
            </caption>
            <thead className="bg-sand-100">
              <tr>
                {(['name', 'weight', 'fee', 'freeOver', 'eta', 'active'] as const).map((key) => (
                  <th key={key} scope="col" className="px-3 py-2 font-medium">
                    {t(`columns.${key}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t('edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {zone.rates.map((rate) => (
                <tr key={rate.id} className="border-line-200 border-t">
                  <td className="px-3 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{rate.names.vi}</span>
                      <span className="text-taupe-600" lang="en">
                        {rate.names.en}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {rate.maxWeightG === null
                      ? t('weightOpen', { min: rate.minWeightG })
                      : t('weight', { min: rate.minWeightG, max: rate.maxWeightG })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{format.vnd(rate.fee)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {rate.freeOverSubtotal === null
                      ? t('noFree')
                      : t('free', { amount: format.vnd(rate.freeOverSubtotal) })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {t('eta', { min: rate.etaMinDays, max: rate.etaMaxDays })}
                  </td>
                  <td className="px-3 py-2">
                    <RateToggle rate={rate} />
                  </td>
                  <td className="px-3 py-2">
                    <RateRowActions zoneId={zone.id} rate={rate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RateToggle({ rate }: { rate: AdminShippingRate }) {
  const t = useTranslations('admin.shipping.rate');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={rate.isActive}
      disabled={pending}
      aria-label={t('toggleFor', { name: rate.names.vi })}
      onCheckedChange={(isActive) =>
        startTransition(async () => {
          const result = await setShippingRateActiveAction({ id: rate.id, isActive });
          if (!result.ok) return feedback.fail(result);
          feedback.success(t(isActive ? 'activated' : 'deactivated'));
        })
      }
    />
  );
}

function RateRowActions({ zoneId, rate }: { zoneId: string; rate: AdminShippingRate }) {
  const t = useTranslations('admin.shipping.rate');
  const feedback = useActionFeedback();
  return (
    <span className="flex justify-end gap-1">
      <RateDialog
        zoneId={zoneId}
        rate={rate}
        trigger={
          <Button variant="ghost" size="sm" aria-label={t('editFor', { name: rate.names.vi })}>
            <Pencil aria-hidden />
          </Button>
        }
      />
      <ConfirmDialog
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            aria-label={t('deleteFor', { name: rate.names.vi })}
          >
            <Trash2 aria-hidden />
          </Button>
        }
        title={t('deleteTitle', { name: rate.names.vi })}
        confirmLabel={t('delete')}
        onConfirm={async () => {
          const result = await deleteShippingRateAction({ id: rate.id });
          if (!result.ok) {
            feedback.fail(result);
            return false;
          }
          feedback.success(t('deleted'));
        }}
      />
    </span>
  );
}

function FormDialog({
  trigger,
  title,
  open,
  onOpenChange,
  children,
}: {
  trigger: ReactNode;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto bg-white"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-h3">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

type ZoneValues = { name: string; provinceCodes: string[]; position: number | null };

function ZoneDialog({
  zone,
  provinces,
  trigger,
}: {
  zone: AdminShippingZone | null;
  provinces: ProvinceOption[];
  trigger: ReactNode;
}) {
  const t = useTranslations('admin.shipping.zone');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults: ZoneValues = {
    name: zone?.name ?? '',
    provinceCodes: zone?.provinceCodes ?? [],
    position: zone?.position ?? 0,
  };
  const form = useForm<ZoneValues>({ defaultValues: defaults });

  function submit(values: ZoneValues) {
    startTransition(async () => {
      const result = await saveShippingZoneAction({
        id: zone?.id ?? null,
        name: values.name,
        provinceCodes: values.provinceCodes,
        position: values.position ?? 0,
      });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('saved'));
      setOpen(false);
      if (!zone) form.reset(defaults);
    });
  }

  return (
    <FormDialog
      trigger={trigger}
      title={zone ? t('edit') : t('new')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(defaults);
      }}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
          <TextField<ZoneValues> name="name" label={t('name')} maxLength={80} />
          <NumberField<ZoneValues> name="position" label={t('position')} min={0} nullable={false} />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                form.setValue(
                  'provinceCodes',
                  provinces.map((p) => p.code),
                  { shouldDirty: true },
                )
              }
            >
              {t('selectAll')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => form.setValue('provinceCodes', [], { shouldDirty: true })}
            >
              {t('clearAll')}
            </Button>
          </div>
          <CheckboxGroupField<ZoneValues>
            name="provinceCodes"
            label={t('provinces')}
            options={provinces.map((p) => ({ value: p.code, label: p.name }))}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tForm('cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {zone ? tForm('save') : tForm('create')}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </FormDialog>
  );
}

type RateValues = {
  nameVi: string;
  nameEn: string;
  minWeightG: number | null;
  maxWeightG: number | null;
  fee: number | null;
  freeOverSubtotal: number | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  position: number | null;
  isActive: boolean;
};

function RateDialog({
  zoneId,
  rate,
  trigger,
}: {
  zoneId: string;
  rate: AdminShippingRate | null;
  trigger: ReactNode;
}) {
  const t = useTranslations('admin.shipping.rate');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults: RateValues = {
    nameVi: rate?.names.vi ?? '',
    nameEn: rate?.names.en ?? '',
    minWeightG: rate?.minWeightG ?? 0,
    maxWeightG: rate?.maxWeightG ?? null,
    fee: rate?.fee ?? null,
    freeOverSubtotal: rate?.freeOverSubtotal ?? null,
    etaMinDays: rate?.etaMinDays ?? null,
    etaMaxDays: rate?.etaMaxDays ?? null,
    position: rate?.position ?? 0,
    isActive: rate?.isActive ?? true,
  };
  const form = useForm<RateValues>({ defaultValues: defaults });

  function submit(values: RateValues) {
    startTransition(async () => {
      const result = await saveShippingRateAction({
        id: rate?.id ?? null,
        zoneId,
        names: { vi: values.nameVi, en: values.nameEn },
        minWeightG: values.minWeightG ?? 0,
        maxWeightG: values.maxWeightG,
        fee: values.fee,
        freeOverSubtotal: values.freeOverSubtotal,
        etaMinDays: values.etaMinDays,
        etaMaxDays: values.etaMaxDays,
        position: values.position ?? 0,
        isActive: values.isActive,
      });
      if (!result.ok) {
        // Server paths are `names.vi` / `names.en`; the form uses flat names.
        feedback.applyFieldErrors(form, {
          ...result,
          fieldErrors: result.fieldErrors.map((issue) => ({
            ...issue,
            path:
              issue.path === 'names.vi'
                ? 'nameVi'
                : issue.path === 'names.en'
                  ? 'nameEn'
                  : issue.path,
          })),
        });
        feedback.fail(result);
        return;
      }
      feedback.success(t('saved'));
      setOpen(false);
      if (!rate) form.reset(defaults);
    });
  }

  return (
    <FormDialog
      trigger={trigger}
      title={rate ? t('editFor', { name: rate.names.vi }) : t('new')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(defaults);
      }}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField<RateValues> name="nameVi" label={t('nameVi')} maxLength={80} />
            <TextField<RateValues> name="nameEn" label={t('nameEn')} maxLength={80} lang="en" />
            <NumberField<RateValues> name="minWeightG" label={t('minWeight')} min={0} />
            <NumberField<RateValues>
              name="maxWeightG"
              label={t('maxWeight')}
              description={t('maxWeightHint')}
              min={1}
            />
            <NumberField<RateValues> name="fee" label={t('fee')} min={0} />
            <NumberField<RateValues>
              name="freeOverSubtotal"
              label={t('freeOver')}
              description={t('freeOverHint')}
              min={1}
            />
            <NumberField<RateValues> name="etaMinDays" label={t('etaMin')} min={0} />
            <NumberField<RateValues> name="etaMaxDays" label={t('etaMax')} min={0} />
            <NumberField<RateValues>
              name="position"
              label={t('position')}
              min={0}
              nullable={false}
            />
          </div>
          <SwitchField<RateValues> name="isActive" label={t('isActive')} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tForm('cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {rate ? tForm('save') : tForm('create')}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </FormDialog>
  );
}
