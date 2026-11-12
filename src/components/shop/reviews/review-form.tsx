'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';

import { submitGuestReviewAction, submitMemberReviewAction } from '@/actions/review';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RatingInput } from '@/components/ui/rating';
import { Textarea } from '@/components/ui/textarea';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { REVIEW_LIMITS, reviewFormSchema, type ReviewFormInput } from '@/lib/validation/review';

export type ReviewFormTarget =
  { kind: 'guest'; token: string } | { kind: 'member'; orderItemId: string };

/** Field and submit errors are codes (`reviews.errors.<code>`), translated here. */
function useReviewError() {
  const t = useTranslations('reviews.errors');
  return (code: string | undefined | null): string =>
    code && t.has(code as 'invalid') ? t(code as 'invalid') : t('invalid');
}

function ReviewFieldMessage() {
  const { error, messageId } = useFormField();
  const message = useReviewError();
  if (!error) return null;
  return (
    <p id={messageId} role="alert" className="text-small text-danger">
      {message(error.message)}
    </p>
  );
}

const SCORES = [1, 2, 3, 4, 5] as const;

/** Optional 1–5 scale (longevity, sillage) as native radios with a "skip" choice. */
function ScoreField({
  name,
  legend,
  labels,
  skipLabel,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  labels: Record<(typeof SCORES)[number], string>;
  skipLabel: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  const options: Array<{ value: number | null; label: string }> = [
    ...SCORES.map((score) => ({ value: score as number | null, label: labels[score] })),
    { value: null, label: skipLabel },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-small mb-2 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value ?? 'skip'}`;
          const checked = (value ?? null) === option.value;
          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className={cn(
                'text-small border-line-200 inline-flex min-h-11 cursor-pointer items-center border px-3',
                'has-focus-visible:outline-gold-700 has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
                checked && 'border-ink-950 bg-ink-950 text-ivory-50',
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * ReviewForm (§8.3): member (from the account) or guest (one-time e-mailed link). Validated
 * with the shared schema in the browser and again on the server; the review is moderated
 * before it is published.
 */
export function ReviewForm({
  target,
  defaultName,
  onSubmitted,
}: {
  target: ReviewFormTarget;
  defaultName: string;
  onSubmitted?: () => void;
}) {
  const t = useTranslations('reviews.form');
  const locale = useLocale() as Locale;
  const errorMessage = useReviewError();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ReviewFormInput>({
    resolver: zodResolver(reviewFormSchema) as unknown as Resolver<ReviewFormInput>,
    defaultValues: {
      rating: 0,
      longevity: null,
      sillage: null,
      title: '',
      body: '',
      reviewerName: defaultName,
    },
  });
  const body = useWatch({ control: form.control, name: 'body' }) ?? '';

  const scale = (group: 'longevity' | 'sillage') =>
    Object.fromEntries(SCORES.map((score) => [score, t(`${group}Scale.${score}`)])) as Record<
      (typeof SCORES)[number],
      string
    >;

  async function onSubmit() {
    setFormError(null);
    const values = form.getValues();
    const result =
      target.kind === 'guest'
        ? await submitGuestReviewAction({ locale, review: { ...values, token: target.token } })
        : await submitMemberReviewAction({
            locale,
            review: { ...values, orderItemId: target.orderItemId },
          });
    if (result.ok) {
      onSubmitted?.();
      return;
    }
    for (const issue of result.fieldErrors) {
      if (issue.path in values) {
        form.setError(issue.path as keyof ReviewFormInput, { type: 'server', message: issue.code });
      }
    }
    setFormError(errorMessage(result.error));
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-6"
        data-testid="review-form"
      >
        {formError && (
          <p role="alert" className="text-small border-danger text-danger border px-4 py-3">
            {formError}
          </p>
        )}
        <FormField
          control={form.control}
          name="rating"
          render={({ field, fieldState }) => (
            <FormItem>
              <span className="text-small font-medium">{t('rating')}</span>
              <RatingInput
                name={field.name}
                value={field.value || 0}
                onValueChange={(value) => field.onChange(value)}
                invalid={Boolean(fieldState.error)}
              />
              <ReviewFieldMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="longevity"
            render={({ field }) => (
              <FormItem>
                <ScoreField
                  name={field.name}
                  legend={t('longevity')}
                  labels={scale('longevity')}
                  skipLabel={t('skip')}
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sillage"
            render={({ field }) => (
              <FormItem>
                <ScoreField
                  name={field.name}
                  legend={t('sillage')}
                  labels={scale('sillage')}
                  skipLabel={t('skip')}
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('title')}</FormLabel>
              <FormControl>
                <Input maxLength={REVIEW_LIMITS.titleMax} {...field} value={field.value ?? ''} />
              </FormControl>
              <ReviewFieldMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('body')}</FormLabel>
              <FormControl>
                <Textarea rows={6} maxLength={REVIEW_LIMITS.bodyMax} {...field} />
              </FormControl>
              <FormDescription>
                {t('bodyHint', {
                  min: REVIEW_LIMITS.bodyMin,
                  count: body.length,
                  max: REVIEW_LIMITS.bodyMax,
                })}
              </FormDescription>
              <ReviewFieldMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reviewerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input autoComplete="given-name" maxLength={REVIEW_LIMITS.nameMax} {...field} />
              </FormControl>
              <FormDescription>{t('nameHint')}</FormDescription>
              <ReviewFieldMessage />
            </FormItem>
          )}
        />
        <p className="text-small text-taupe-600">{t('moderation')}</p>
        <Button
          type="submit"
          size="lg"
          className="self-start"
          loading={form.formState.isSubmitting}
        >
          {t('submit')}
        </Button>
      </form>
    </Form>
  );
}
