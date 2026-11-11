'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TranslationStatus } from '@/server/modules/catalog';

import { TranslationStatusBadge } from '../translation-status-badge';

export type ContentLocale = 'vi' | 'en';

/**
 * vi/en content tabs (§8.4). Vietnamese is always present; English can be added or removed
 * (ADR-0021: English is written by an editor, never machine-filled).
 */
export function TranslationTabs({
  value,
  onValueChange,
  status,
  hasEnglish,
  onAddEnglish,
  onRemoveEnglish,
  children,
}: {
  value: ContentLocale;
  onValueChange: (locale: ContentLocale) => void;
  status: Record<ContentLocale, TranslationStatus>;
  hasEnglish: boolean;
  onAddEnglish: () => void;
  onRemoveEnglish: () => void;
  children: (locale: ContentLocale) => ReactNode;
}) {
  const t = useTranslations('admin.translation');
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as ContentLocale)}>
      <TabsList aria-label={t('tabsLabel')}>
        {(['vi', 'en'] as const).map((locale) => (
          <TabsTrigger key={locale} value={locale} className="gap-2 normal-case">
            {t(`locale.${locale}`)}
            <TranslationStatusBadge locale={locale} status={status[locale]} compact />
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="vi" className="flex flex-col gap-5">
        {children('vi')}
      </TabsContent>
      <TabsContent value="en" className="flex flex-col gap-5">
        <p className="text-small text-taupe-600">{t('englishHint')}</p>
        {hasEnglish ? (
          <>
            {children('en')}
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={onRemoveEnglish}>
                <Trash2 aria-hidden />
                {t('removeEnglish')}
              </Button>
            </div>
          </>
        ) : (
          <div className="border-line-200 flex flex-col items-start gap-3 border border-dashed p-6">
            <p>{t('englishMissing')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={onAddEnglish}>
              <Plus aria-hidden />
              {t('addEnglish')}
            </Button>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

/** Status of one translation in a form: missing, draft or published. */
export function formTranslationStatus(value: object | null | undefined): TranslationStatus {
  if (!value) return 'missing';
  if (!('isPublished' in value)) return 'published';
  return value.isPublished ? 'published' : 'draft';
}
