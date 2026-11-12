'use client';

import { useTranslations } from 'next-intl';
import { useTransition, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';

import { saveSettingsSectionAction } from '@/actions/admin/settings';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SettingsSection, SettingsSectionValues } from '@/server/modules/settings';

import { useActionFeedback } from '../form/action-feedback';
import { NumberField, SelectField, TextareaField, TextField } from '../form/fields';

/*
 * /admin/settings (§11.2 Settings): one tab and one form per section; each save writes only its
 * own keys (Zod → permission → audit → revalidation on the server). Inactive tabs stay mounted
 * so unsaved edits survive switching tabs.
 */

export type SettingsEnvInfo = {
  /** TELEGRAM_BOT_TOKEN is set (the token itself never leaves the server). */
  telegramBotConfigured: boolean;
  /** STAFF_ALERT_EMAIL is set: used when no recipient is saved here. */
  staffAlertEmailFallback: boolean;
  /** EMAIL_FROM (not a secret), the sender used when nothing is saved here. */
  emailFrom: string;
};

const SECTIONS: SettingsSection[] = [
  'company',
  'checkout',
  'returns',
  'einvoice',
  'alerts',
  'seo',
  'email',
];

export function SettingsManager({
  values,
  env,
  vatRates,
}: {
  values: SettingsSectionValues;
  env: SettingsEnvInfo;
  vatRates: readonly number[];
}) {
  const t = useTranslations('admin.settings');
  return (
    <Tabs defaultValue="company" className="flex flex-col">
      <TabsList aria-label={t('tabsLabel')} className="flex-wrap gap-x-6 gap-y-0">
        {SECTIONS.map((section) => (
          <TabsTrigger key={section} value={section} className="normal-case">
            {t(`sections.${section}.tab`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="company" forceMount className="data-[state=inactive]:hidden">
        <CompanyForm values={values.company} />
      </TabsContent>
      <TabsContent value="checkout" forceMount className="data-[state=inactive]:hidden">
        <CheckoutForm values={values.checkout} />
      </TabsContent>
      <TabsContent value="returns" forceMount className="data-[state=inactive]:hidden">
        <ReturnsForm values={values.returns} />
      </TabsContent>
      <TabsContent value="einvoice" forceMount className="data-[state=inactive]:hidden">
        <EinvoiceForm values={values.einvoice} vatRates={vatRates} />
      </TabsContent>
      <TabsContent value="alerts" forceMount className="data-[state=inactive]:hidden">
        <AlertsForm values={values.alerts} env={env} />
      </TabsContent>
      <TabsContent value="seo" forceMount className="data-[state=inactive]:hidden">
        <SeoForm values={values.seo} />
      </TabsContent>
      <TabsContent value="email" forceMount className="data-[state=inactive]:hidden">
        <EmailForm values={values.email} env={env} />
      </TabsContent>
    </Tabs>
  );
}

// ---------- Shared section shell ----------

function Note({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <p
      role="note"
      className={
        tone === 'warning'
          ? 'border-warning text-small border-l-2 pl-3'
          : 'border-line-200 text-small border-l-2 pl-3 text-taupe-600'
      }
    >
      {children}
    </p>
  );
}

function useSectionSave<T extends FieldValues>(
  section: SettingsSection,
  form: UseFormReturn<T>,
  toPayload: (values: T) => Record<string, unknown> = (values) => values,
  mapErrorPath: (path: string) => string = (path) => path,
) {
  const t = useTranslations('admin.settings');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();

  function submit(values: T) {
    startTransition(async () => {
      const result = await saveSettingsSectionAction({ section, values: toPayload(values) });
      if (!result.ok) {
        feedback.applyFieldErrors(
          form,
          {
            ...result,
            fieldErrors: result.fieldErrors.map((issue) => ({
              ...issue,
              path: issue.path.startsWith('values.')
                ? `values.${mapErrorPath(issue.path.slice('values.'.length))}`
                : issue.path,
            })),
          },
          'values.',
        );
        feedback.fail(result);
        return;
      }
      feedback.success(result.data.changedKeys.length > 0 ? t('saved') : t('noChanges'));
      form.reset(values);
    });
  }
  return { pending, onSubmit: form.handleSubmit(submit) };
}

function SectionForm<T extends FieldValues>({
  section,
  form,
  onSubmit,
  pending,
  notes,
  children,
}: {
  section: SettingsSection;
  form: UseFormReturn<T>;
  onSubmit: () => void;
  pending: boolean;
  notes?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('admin.settings');
  const headingId = `settings-${section}-title`;
  return (
    <section aria-labelledby={headingId} className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3">
          {t(`sections.${section}.title`)}
        </h2>
        <p className="text-small text-taupe-600">{t(`sections.${section}.description`)}</p>
      </div>
      {notes}
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          noValidate
          className="border-line-200 flex flex-col gap-5 border bg-white p-5"
          aria-labelledby={headingId}
        >
          {children}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={pending}>
              {t('save')}
            </Button>
            {form.formState.isDirty && (
              <span className="text-small text-taupe-600">{t('unsaved')}</span>
            )}
          </div>
        </form>
      </Form>
    </section>
  );
}

const grid = 'grid gap-5 md:grid-cols-2';

// ---------- Company & seller info (+ MOIT badge) ----------

type CompanyValues = {
  [K in keyof SettingsSectionValues['company']]: string | null;
};

function CompanyForm({ values }: { values: SettingsSectionValues['company'] }) {
  const t = useTranslations('admin.settings.company');
  const form = useForm<CompanyValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('company', form);
  return (
    <SectionForm section="company" form={form} onSubmit={onSubmit} pending={pending}>
      <div className={grid}>
        <TextField<CompanyValues>
          name="name"
          label={t('name')}
          maxLength={200}
          className="md:col-span-2"
        />
        <TextField<CompanyValues>
          name="taxCode"
          label={t('taxCode')}
          description={t('taxCodeHint')}
          maxLength={14}
          inputMode="numeric"
        />
        <TextField<CompanyValues>
          name="legalRepresentative"
          label={t('legalRepresentative')}
          maxLength={120}
        />
        <TextField<CompanyValues>
          name="address"
          label={t('address')}
          maxLength={300}
          className="md:col-span-2"
        />
        <TextField<CompanyValues>
          name="phone"
          label={t('phone')}
          maxLength={20}
          type="tel"
          autoComplete="off"
        />
        <TextField<CompanyValues>
          name="email"
          label={t('email')}
          maxLength={254}
          type="email"
          autoComplete="off"
        />
        <TextareaField<CompanyValues>
          name="businessRegistration"
          label={t('businessRegistration')}
          description={t('businessRegistrationHint')}
          maxLength={300}
          rows={2}
          className="md:col-span-2"
        />
      </div>
      <fieldset className="flex flex-col gap-5">
        <legend className="text-body mb-2 font-medium">{t('moitTitle')}</legend>
        <Note>{t('moitNote')}</Note>
        <TextField<CompanyValues>
          name="moitNotificationUrl"
          label={t('moitNotificationUrl')}
          description={t('moitNotificationUrlHint')}
          maxLength={500}
          type="url"
          inputMode="url"
        />
        <TextField<CompanyValues>
          name="moitBadgeImageUrl"
          label={t('moitBadgeImageUrl')}
          description={t('moitBadgeImageUrlHint')}
          maxLength={500}
          inputMode="url"
        />
      </fieldset>
    </SectionForm>
  );
}

// ---------- Checkout & COD ----------

type CheckoutValues = SettingsSectionValues['checkout'];

function CheckoutForm({ values }: { values: CheckoutValues }) {
  const t = useTranslations('admin.settings.checkout');
  const form = useForm<CheckoutValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('checkout', form);
  const number = (name: keyof CheckoutValues, props: { min: number; max: number }) => (
    <NumberField<CheckoutValues>
      name={name}
      label={t(name)}
      description={t(`${name}Hint`)}
      nullable={false}
      {...props}
    />
  );
  return (
    <SectionForm
      section="checkout"
      form={form}
      onSubmit={onSubmit}
      pending={pending}
      notes={<Note tone="warning">{t('pricesWarning')}</Note>}
    >
      <fieldset className={grid}>
        <legend className="text-body mb-2 font-medium md:col-span-2">{t('codTitle')}</legend>
        {number('codMaxOrderWithoutDeposit', { min: 0, max: 1_000_000_000 })}
        {number('codDepositPercent', { min: 0, max: 100 })}
        {number('codConfirmationWindowHours', { min: 1, max: 168 })}
      </fieldset>
      <fieldset className={grid}>
        <legend className="text-body mb-2 font-medium md:col-span-2">{t('onlineTitle')}</legend>
        {number('paymentSessionMinutes', { min: 5, max: 60 })}
        {number('onlineReservationMinutes', { min: 10, max: 240 })}
      </fieldset>
      <fieldset className={grid}>
        <legend className="text-body mb-2 font-medium md:col-span-2">{t('cartTitle')}</legend>
        {number('giftWrapFee', { min: 0, max: 1_000_000 })}
        {number('maxQuantityPerLine', { min: 1, max: 50 })}
      </fieldset>
    </SectionForm>
  );
}

// ---------- Returns ----------

type ReturnsValues = SettingsSectionValues['returns'];

function ReturnsForm({ values }: { values: ReturnsValues }) {
  const t = useTranslations('admin.settings.returns');
  const form = useForm<ReturnsValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('returns', form);
  return (
    <SectionForm
      section="returns"
      form={form}
      onSubmit={onSubmit}
      pending={pending}
      notes={<Note tone="warning">{t('policyWarning')}</Note>}
    >
      <NumberField<ReturnsValues>
        name="windowDays"
        label={t('windowDays')}
        description={t('windowDaysHint')}
        nullable={false}
        min={7}
        max={30}
        className="max-w-xs"
      />
    </SectionForm>
  );
}

// ---------- E-invoice ----------

type EinvoiceValues = SettingsSectionValues['einvoice'];

function EinvoiceForm({
  values,
  vatRates,
}: {
  values: EinvoiceValues;
  vatRates: readonly number[];
}) {
  const t = useTranslations('admin.settings.einvoice');
  const form = useForm<EinvoiceValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('einvoice', form);
  return (
    <SectionForm
      section="einvoice"
      form={form}
      onSubmit={onSubmit}
      pending={pending}
      notes={<Note tone="warning">{t('pendingAccountant')}</Note>}
    >
      <SelectField<EinvoiceValues>
        name="vatRatePercent"
        label={t('vatRatePercent')}
        description={t('vatRatePercentHint')}
        numeric
        options={vatRates.map((rate) => ({ value: String(rate), label: t('rate', { rate }) }))}
        className="max-w-xs"
      />
    </SectionForm>
  );
}

// ---------- Internal alerts ----------

type AlertsFormValues = { emailRecipients: string; telegramChatId: string | null };

/** One address per line (commas and semicolons also separate). */
export function splitRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function AlertsForm({
  values,
  env,
}: {
  values: SettingsSectionValues['alerts'];
  env: SettingsEnvInfo;
}) {
  const t = useTranslations('admin.settings.alerts');
  const form = useForm<AlertsFormValues>({
    defaultValues: {
      emailRecipients: (values.emailRecipients ?? []).join('\n'),
      telegramChatId: values.telegramChatId,
    },
  });
  const { pending, onSubmit } = useSectionSave(
    'alerts',
    form,
    (v) => ({
      emailRecipients: splitRecipients(v.emailRecipients),
      telegramChatId: v.telegramChatId,
    }),
    (path) => (path.startsWith('emailRecipients') ? 'emailRecipients' : path),
  );
  return (
    <SectionForm
      section="alerts"
      form={form}
      onSubmit={onSubmit}
      pending={pending}
      notes={
        <>
          <Note>{t('precedence')}</Note>
          <Note tone={env.telegramBotConfigured ? 'info' : 'warning'}>
            {env.telegramBotConfigured ? t('botConfigured') : t('botMissing')}
          </Note>
        </>
      }
    >
      <TextareaField<AlertsFormValues>
        name="emailRecipients"
        label={t('emailRecipients')}
        description={
          env.staffAlertEmailFallback ? t('emailRecipientsHintFallback') : t('emailRecipientsHint')
        }
        rows={3}
        autoComplete="off"
        spellCheck={false}
      />
      <TextField<AlertsFormValues>
        name="telegramChatId"
        label={t('telegramChatId')}
        description={t('telegramChatIdHint')}
        maxLength={64}
        autoComplete="off"
        className="max-w-sm"
      />
    </SectionForm>
  );
}

// ---------- SEO defaults ----------

type SeoValues = SettingsSectionValues['seo'];

function SeoForm({ values }: { values: SeoValues }) {
  const t = useTranslations('admin.settings.seo');
  const form = useForm<SeoValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('seo', form);
  return (
    <SectionForm section="seo" form={form} onSubmit={onSubmit} pending={pending}>
      {(['vi', 'en'] as const).map((locale) => (
        <fieldset key={locale} className="flex flex-col gap-5">
          <legend className="text-body mb-2 font-medium">{t(`legend.${locale}`)}</legend>
          <TextField<SeoValues>
            name={locale === 'vi' ? 'titleVi' : 'titleEn'}
            label={t('title')}
            description={t('titleHint')}
            maxLength={70}
            lang={locale}
          />
          <TextareaField<SeoValues>
            name={locale === 'vi' ? 'descriptionVi' : 'descriptionEn'}
            label={t('description')}
            description={t('descriptionHint')}
            maxLength={170}
            rows={3}
            lang={locale}
          />
        </fieldset>
      ))}
    </SectionForm>
  );
}

// ---------- Sender e-mail ----------

type EmailValues = SettingsSectionValues['email'];

function EmailForm({ values, env }: { values: EmailValues; env: SettingsEnvInfo }) {
  const t = useTranslations('admin.settings.email');
  const form = useForm<EmailValues>({ defaultValues: values });
  const { pending, onSubmit } = useSectionSave('email', form);
  return (
    <SectionForm
      section="email"
      form={form}
      onSubmit={onSubmit}
      pending={pending}
      notes={
        <>
          <Note>{t('fallback', { from: env.emailFrom })}</Note>
          <Note tone="warning">{t('domainWarning')}</Note>
        </>
      }
    >
      <div className={grid}>
        <TextField<EmailValues> name="senderName" label={t('senderName')} maxLength={80} />
        <TextField<EmailValues>
          name="senderAddress"
          label={t('senderAddress')}
          maxLength={254}
          type="email"
          autoComplete="off"
        />
      </div>
    </SectionForm>
  );
}
