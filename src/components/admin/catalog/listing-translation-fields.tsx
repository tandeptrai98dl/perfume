'use client';

import { useTranslations } from 'next-intl';
import type { FieldValues, Path } from 'react-hook-form';

import { storefrontPath, type SlugEntityType } from '@/lib/storefront-path';

import { SwitchField, TextareaField, TextField } from '../form/fields';
import { SeoFields } from '../form/seo-fields';
import { SlugField } from '../form/slug-field';
import type { ContentLocale } from '../form/translation-tabs';

/** Translation of a listing page (category, collection): name, slug, text, SEO, publish. */
export type ListingTranslationForm = {
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
};

export const emptyListingTranslation = (isPublished = false): ListingTranslationForm => ({
  name: '',
  slug: '',
  description: null,
  seoTitle: null,
  seoDescription: null,
  isPublished,
});

export function ListingTranslationFields<T extends FieldValues>({
  lang,
  entity,
  value,
  original,
  appUrl,
  nameLabel,
  descriptionLabel,
  seo = true,
}: {
  lang: ContentLocale;
  entity: SlugEntityType | null;
  value: Partial<ListingTranslationForm> | null | undefined;
  original: { slug: string; isPublished?: boolean } | null | undefined;
  appUrl: string;
  nameLabel: string;
  descriptionLabel: string;
  /** Categories and collections have SEO fields and a publish flag; families/notes do not. */
  seo?: boolean;
}) {
  const t = useTranslations('admin');
  const prefix = `translations.${lang}`;
  return (
    <>
      <TextField<T>
        name={`${prefix}.name` as Path<T>}
        label={nameLabel}
        required
        autoComplete="off"
      />
      <SlugField<T>
        name={`${prefix}.slug` as Path<T>}
        sourceName={`${prefix}.name` as Path<T>}
        follow={!original}
        originalSlug={original?.slug}
        published={!!entity && !!original && original.isPublished !== false}
        previewPrefix={entity ? storefrontPath(entity, lang, '') : undefined}
      />
      <TextareaField<T>
        name={`${prefix}.description` as Path<T>}
        label={descriptionLabel}
        rows={5}
      />
      {seo && entity && (
        <SeoFields<T>
          prefix={prefix}
          fallbackTitle={value?.name ?? ''}
          fallbackDescription={value?.description ?? ''}
          url={`${appUrl}${storefrontPath(entity, lang, value?.slug ?? '')}`}
        />
      )}
      {seo && (
        <SwitchField<T>
          name={`${prefix}.isPublished` as Path<T>}
          label={t('translation.isPublished', { locale: t(`translation.locale.${lang}`) })}
        />
      )}
    </>
  );
}
