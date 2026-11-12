'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { openReturnForCustomerAction } from '@/actions/admin/returns';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { StaffReturnOptions } from '@/server/modules/returns';

import { useActionFeedback } from '../form/action-feedback';
import { useOrderFormat } from './format';
import { ActionDialog } from './return-panel';

/*
 * OpenReturnDialog (ADR-0017, ADR-0027, §11.2): staff open a return on the customer's behalf
 * (phone, chat) with the same rules as the storefront form. After the return window only a
 * manager can open it, with a reason that is audited. The request then follows the normal
 * approve → receive flow in the return panel.
 */

const REASONS = ['unopened', 'defective', 'wrong_item', 'damaged'] as const;
type Reason = (typeof REASONS)[number];

export function OpenReturnDialog({
  orderId,
  orderCode,
  options,
  canOverride,
}: {
  orderId: string;
  orderCode: string;
  options: StaffReturnOptions;
  /** `payments.refund` (Owner/Manager): may lift the return window. */
  canOverride: boolean;
}) {
  const t = useTranslations('admin.returns');
  const feedback = useActionFeedback();
  const format = useOrderFormat();
  const id = useId();
  const { items } = options;
  const [selected, setSelected] = useState<Record<string, number>>(
    items.length === 1 ? { [items[0]!.id]: items[0]!.quantity } : {},
  );
  const [reason, setReason] = useState<Reason | null>(null);
  const [resolution, setResolution] = useState<'refund' | 'replacement'>('refund');
  const [description, setDescription] = useState('');
  const [sealIntact, setSealIntact] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const fault = reason !== null && reason !== 'unopened';
  const lines = Object.entries(selected)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const canSubmit =
    lines.length > 0 &&
    reason !== null &&
    (!options.needsOverride || overrideReason.trim().length >= 5);

  if (options.needsOverride && !canOverride) {
    return (
      <p className="text-small text-taupe-600" data-testid="open-return-expired">
        {t('open.expiredManagerOnly', {
          date: options.deadline ? format.dateTime(options.deadline) : '—',
        })}
      </p>
    );
  }

  return (
    <ActionDialog
      trigger={<Button variant="secondary">{t('open.button')}</Button>}
      title={t('open.title', { code: orderCode })}
      description={t('open.description')}
      confirmLabel={t('open.confirm')}
      canSubmit={canSubmit}
      onSubmit={async () => {
        const result = await openReturnForCustomerAction({
          orderId,
          lines,
          reason,
          resolution: fault ? resolution : 'refund',
          description,
          sealIntact: reason === 'unopened' && sealIntact,
          overrideReason: options.needsOverride ? overrideReason.trim() : null,
        });
        if (!result.ok) {
          feedback.fail(result);
          return false;
        }
        feedback.success(t('open.done', { code: orderCode }));
        return true;
      }}
    >
      {options.needsOverride && (
        <div className="flex flex-col gap-2">
          <p className="text-small text-warning">
            {t('open.overrideNote', {
              date: options.deadline ? format.dateTime(options.deadline) : '—',
            })}
          </p>
          <Label htmlFor={`${id}-override`}>{t('open.overrideReason')}</Label>
          <Textarea
            id={`${id}-override`}
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            rows={2}
            maxLength={500}
            required
          />
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-small mb-1 font-medium">{t('open.lines')}</legend>
        {items.map((item) => {
          const name = `${item.productName} ${item.variantLabel}`.trim();
          const checked = (selected[item.id] ?? 0) > 0;
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-3">
              <div className="flex min-h-11 flex-1 items-center gap-3">
                <Checkbox
                  id={`${id}-line-${item.id}`}
                  checked={checked}
                  onCheckedChange={(value) =>
                    setSelected((current) => ({
                      ...current,
                      [item.id]: value === true ? current[item.id] || item.quantity : 0,
                    }))
                  }
                />
                <Label htmlFor={`${id}-line-${item.id}`} className="cursor-pointer">
                  {t('open.lineLabel', { name, quantity: item.quantity })}
                </Label>
              </div>
              {checked && item.quantity > 1 && (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={item.quantity}
                  value={selected[item.id]}
                  aria-label={t('open.quantity', { name })}
                  className="w-24"
                  onChange={(event) => {
                    const value = Math.min(
                      item.quantity,
                      Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                    );
                    setSelected((current) => ({ ...current, [item.id]: value }));
                  }}
                />
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-small mb-1 font-medium">{t('panel.reason')}</legend>
        <RadioGroup value={reason ?? ''} onValueChange={(value) => setReason(value as Reason)}>
          {REASONS.map((value) => (
            <div key={value} className="flex min-h-11 items-center gap-3">
              <RadioGroupItem id={`${id}-reason-${value}`} value={value} />
              <Label htmlFor={`${id}-reason-${value}`} className="cursor-pointer">
                {t(`reasons.${value}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      {fault && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small mb-1 font-medium">{t('panel.resolution')}</legend>
          <RadioGroup
            value={resolution}
            onValueChange={(value) => setResolution(value as 'refund' | 'replacement')}
          >
            {(['refund', 'replacement'] as const).map((value) => (
              <div key={value} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem id={`${id}-resolution-${value}`} value={value} />
                <Label htmlFor={`${id}-resolution-${value}`} className="cursor-pointer">
                  {t(`resolutions.${value}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      )}
      {reason === 'unopened' && (
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${id}-seal`}
            checked={sealIntact}
            onCheckedChange={(value) => setSealIntact(value === true)}
          />
          <Label htmlFor={`${id}-seal`} className="cursor-pointer">
            {t('open.seal')}
          </Label>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>{t('open.descriptionLabel')}</Label>
        <Textarea
          id={`${id}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={1000}
          aria-describedby={`${id}-description-hint`}
        />
        <p id={`${id}-description-hint`} className="text-small text-taupe-600">
          {fault ? t('open.descriptionFault') : t('open.descriptionHint')}
        </p>
      </div>
    </ActionDialog>
  );
}
