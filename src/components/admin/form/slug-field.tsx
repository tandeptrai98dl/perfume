'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import {
  useFormContext,
  useWatch,
  type FieldValues,
  type Path,
  type PathValue,
} from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toSlug } from '@/lib/slug';

/**
 * Slug input bound to React Hook Form. While the slug has not been edited by hand (new
 * entities), it follows `sourceName` (the name field). Changing the slug of a published page
 * shows the 301 redirect warning.
 */
export function SlugField<T extends FieldValues>({
  name,
  sourceName,
  follow,
  originalSlug,
  published,
  previewPrefix,
}: {
  name: Path<T>;
  /** Field whose value generates the slug; omit for entities without a translated name. */
  sourceName?: Path<T>;
  /** Start in auto-follow mode (new entity or empty slug). */
  follow: boolean;
  originalSlug?: string | null;
  published?: boolean;
  /** Storefront path before the slug, e.g. `/san-pham/`. */
  previewPrefix?: string;
}) {
  const t = useTranslations('admin.slug');
  const form = useFormContext<T>();
  const following = useRef(follow);
  const source = useWatch({
    control: form.control,
    name: (sourceName ?? name) as Path<T>,
  }) as unknown;
  const slug = useWatch({ control: form.control, name }) as unknown as string | undefined;

  useEffect(() => {
    if (!sourceName || !following.current || typeof source !== 'string') return;
    form.setValue(name, toSlug(source) as PathValue<T, Path<T>>, { shouldDirty: true });
  }, [source, sourceName, name, form]);

  const changedPublished = published && originalSlug && slug && slug !== originalSlug;

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('label')}</FormLabel>
          <div className="flex gap-2">
            <FormControl>
              <Input
                {...field}
                value={(field.value as string | undefined) ?? ''}
                onChange={(event) => {
                  following.current = false;
                  field.onChange(event.target.value.toLowerCase());
                }}
                onBlur={(event) => {
                  const normalized = toSlug(event.target.value);
                  if (normalized !== event.target.value) field.onChange(normalized);
                  field.onBlur();
                }}
                spellCheck={false}
                autoCapitalize="off"
                className="font-mono"
              />
            </FormControl>
            {sourceName && (
              <button
                type="button"
                className="border-line-200 hover:border-ink-950 text-small inline-flex min-h-11 shrink-0 items-center gap-2 border px-3"
                onClick={() => {
                  following.current = true;
                  const value = form.getValues(sourceName);
                  form.setValue(name, toSlug(String(value ?? '')) as PathValue<T, Path<T>>, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              >
                <RefreshCw aria-hidden className="size-4" />
                {t('regenerate')}
              </button>
            )}
          </div>
          <FormDescription>
            {previewPrefix && slug ? (
              <span className="font-mono">
                {previewPrefix}
                {slug}
              </span>
            ) : (
              t('hint')
            )}
          </FormDescription>
          {changedPublished && (
            <p role="status" className="text-small text-warning">
              {t('publishedWarning')}
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
