'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { updateProfileAction } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { profileSchema } from '@/lib/validation/account';

import { AccountFormMessage, FormNotice, useAccountError } from './form-message';

type ProfileFormValues = z.input<typeof profileSchema>;

/** Profile (§10.6): name, phone, birthday, e-mail language (`users.locale`), marketing opt-in. */
export function ProfileForm({ email, initial }: { email: string; initial: ProfileFormValues }) {
  const t = useTranslations('account.profile');
  const errorMessage = useAccountError();
  const [formError, setFormError] = useState<string | null>(null);
  // Validates with the shared schema; the raw form values are sent and parsed again on the
  // server (the schema's output uses null for empty optional fields).
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema) as unknown as Resolver<ProfileFormValues>,
    defaultValues: initial,
  });

  async function onSubmit() {
    setFormError(null);
    const values = form.getValues();
    const result = await updateProfileAction(values);
    if (result.ok) {
      toast.success(t('saved'));
      form.reset(values);
      return;
    }
    for (const issue of result.fieldErrors) {
      if (issue.path in initial) {
        form.setError(issue.path as keyof ProfileFormValues, {
          type: 'server',
          message: issue.code,
        });
      }
    }
    setFormError(errorMessage(result.error));
  }

  return (
    <Form {...form}>
      <form
        method="post"
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex max-w-xl flex-col gap-6"
        noValidate
      >
        {formError && <FormNotice tone="error">{formError}</FormNotice>}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-email">{t('fields.email')}</Label>
          <Input id="profile-email" value={email} readOnly aria-describedby="profile-email-hint" />
          <p id="profile-email-hint" className="text-small text-taupe-600">
            {t('fields.emailHint')}
          </p>
        </div>
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.phone')}</FormLabel>
              <FormControl>
                <Input type="tel" autoComplete="tel" inputMode="tel" {...field} />
              </FormControl>
              <FormDescription>{t('fields.phoneHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="birthday"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.birthday')}</FormLabel>
              <FormControl>
                <Input type="date" autoComplete="bday" className="max-w-56" {...field} />
              </FormControl>
              <FormDescription>{t('fields.birthdayHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FormItem>
              <fieldset className="flex flex-col gap-3">
                <legend className="text-small mb-2 font-medium">{t('fields.locale')}</legend>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex flex-wrap gap-x-8 gap-y-2"
                  aria-describedby="profile-locale-hint"
                >
                  {(['vi', 'en'] as const).map((value) => (
                    <div key={value} className="flex min-h-11 items-center gap-3">
                      <RadioGroupItem value={value} id={`profile-locale-${value}`} />
                      <Label htmlFor={`profile-locale-${value}`} lang={value}>
                        {t(`languages.${value}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p id="profile-locale-hint" className="text-small text-taupe-600">
                  {t('fields.localeHint')}
                </p>
              </fieldset>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="marketingOptIn"
          render={({ field }) => (
            <FormItem className="flex-row items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  className="mt-3"
                />
              </FormControl>
              <div className="flex flex-col gap-1">
                <FormLabel className="min-h-11 content-center">{t('fields.marketing')}</FormLabel>
                <FormDescription>{t('fields.marketingHint')}</FormDescription>
              </div>
            </FormItem>
          )}
        />
        <Button type="submit" loading={form.formState.isSubmitting} className="self-start">
          {t('save')}
        </Button>
      </form>
    </Form>
  );
}
