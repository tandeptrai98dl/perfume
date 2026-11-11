'use client';

import { useTranslations } from 'next-intl';
import { useFormContext, useWatch, type FieldValues, type Path } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Search snippet guidance (ARCHITECTURE.md §13.1). */
const TITLE_RECOMMENDED = 60;
const DESCRIPTION_RECOMMENDED = 155;

function Counter({ count, max }: { count: number; max: number }) {
  const t = useTranslations('admin.seo');
  return (
    <span className={cn('tabular-nums', count > max && 'text-warning')}>
      {t('counter', { count, max })}
      {count > max && ` · ${t('tooLong')}`}
    </span>
  );
}

/**
 * SEO title/description for one locale plus a Google snippet preview (§8.4). Empty fields
 * fall back to the name and the start of the description on the storefront.
 */
export function SeoFields<T extends FieldValues>({
  prefix,
  fallbackTitle,
  fallbackDescription,
  url,
}: {
  /** RHF path of the translation, e.g. `translations.vi`. */
  prefix: string;
  fallbackTitle: string;
  fallbackDescription?: string;
  /** Full storefront URL shown in the preview. */
  url: string;
}) {
  const t = useTranslations('admin.seo');
  const form = useFormContext<T>();
  const titleName = `${prefix}.seoTitle` as Path<T>;
  const descriptionName = `${prefix}.seoDescription` as Path<T>;
  const title = (useWatch({ control: form.control, name: titleName }) as string | null) ?? '';
  const description =
    (useWatch({ control: form.control, name: descriptionName }) as string | null) ?? '';
  const shownTitle = title || fallbackTitle;
  const shownDescription = description || fallbackDescription || '';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <FormField
          control={form.control}
          name={titleName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('seoTitle')}</FormLabel>
              <FormControl>
                <Input {...field} value={(field.value as string | null) ?? ''} maxLength={70} />
              </FormControl>
              <FormDescription>
                <Counter count={title.length} max={TITLE_RECOMMENDED} />
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={descriptionName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('seoDescription')}</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={(field.value as string | null) ?? ''}
                  rows={3}
                  maxLength={170}
                />
              </FormControl>
              <FormDescription>
                <Counter count={description.length} max={DESCRIPTION_RECOMMENDED} />
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="text-small text-taupe-600">{t('fallbackHint')}</p>
      </div>
      <figure className="border-line-200 flex flex-col gap-1 border p-4">
        <figcaption className="eyebrow mb-2 text-taupe-600">{t('preview')}</figcaption>
        <p className="text-small truncate text-taupe-600">{url}</p>
        <p className="text-body-lg text-info truncate">
          {shownTitle.length > TITLE_RECOMMENDED
            ? `${shownTitle.slice(0, TITLE_RECOMMENDED - 1)}…`
            : shownTitle}
        </p>
        <p className="text-small text-ink-700 line-clamp-2">
          {shownDescription.length > DESCRIPTION_RECOMMENDED
            ? `${shownDescription.slice(0, DESCRIPTION_RECOMMENDED - 1)}…`
            : shownDescription}
        </p>
      </figure>
    </div>
  );
}
