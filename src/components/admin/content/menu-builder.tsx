'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';

import { saveMenuAction } from '@/actions/admin/content';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { localizedPath, matchLocalizedPath } from '@/lib/seo/paths';

import { FormError, SubmitBar, useActionSubmit } from './form-kit';

import type { MenuRow } from './values';

type FormValues = { rows: MenuRow[] };

/** English URL for a Vietnamese storefront path without params (`/tap-chi` → `/en/journal`). */
function englishHref(href: string): string {
  const match = matchLocalizedPath(href);
  if (match && match.locale === 'vi' && Object.keys(match.params).length === 0) {
    return localizedPath('en', match.pathname);
  }
  return href;
}

function newRowId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * MenuBuilder (§8.4): ordered items, each with a label and link per locale. An item without an
 * English label is left out of the English menu; an empty English link reuses the Vietnamese
 * page's English URL when it can be derived.
 */
export function MenuBuilder({ menuKey, rows }: { menuKey: string; rows: MenuRow[] }) {
  const t = useTranslations('admin.content');
  const form = useForm<FormValues>({ defaultValues: { rows } });
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'rows' });
  const { pending, formError, saved, submit } = useActionSubmit(form);

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) =>
        submit(() =>
          saveMenuAction({
            key: menuKey,
            items: {
              vi: values.rows
                .filter((r) => r.labelVi.trim() && r.hrefVi.trim())
                .map((r) => ({ id: r.id, label: r.labelVi, href: r.hrefVi })),
              en: values.rows
                .filter((r) => r.labelEn.trim() && (r.hrefEn.trim() || r.hrefVi.trim()))
                .map((r) => ({
                  id: r.id,
                  label: r.labelEn,
                  href: r.hrefEn.trim() || englishHref(r.hrefVi.trim()),
                })),
            },
          }),
        ),
      )}
    >
      <FormError code={formError} />
      <p className="text-small text-taupe-600">{t('hints.menu')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <caption className="sr-only">{t(`menuKeys.${menuKey as 'header'}`)}</caption>
          <thead>
            <tr className="border-line-200 text-small border-b">
              <th scope="col" className="py-2 pe-3 font-medium">
                #
              </th>
              <th scope="col" className="py-2 pe-3 font-medium">
                {t('fields.labelVi')}
              </th>
              <th scope="col" className="py-2 pe-3 font-medium">
                {t('fields.hrefVi')}
              </th>
              <th scope="col" className="py-2 pe-3 font-medium">
                {t('fields.labelEn')}
              </th>
              <th scope="col" className="py-2 pe-3 font-medium">
                {t('fields.hrefEn')}
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-taupe-600">
                  {t('empty.menu')}
                </td>
              </tr>
            )}
            {fields.map((field, index) => (
              <tr key={field.id} className="border-line-200 border-b align-top">
                <td className="text-small py-2 pe-3 pt-5 tabular-nums">{index + 1}</td>
                {(['labelVi', 'hrefVi', 'labelEn', 'hrefEn'] as const).map((name) => (
                  <td key={name} className="py-2 pe-3">
                    <Input
                      aria-label={`${t(`fields.${name}`)} ${index + 1}`}
                      placeholder={name === 'hrefEn' ? t('hints.hrefEn') : undefined}
                      {...form.register(`rows.${index}.${name}`)}
                    />
                  </td>
                ))}
                <td className="flex gap-1 py-2">
                  <IconButton
                    aria-label={t('menu.moveUp', { n: index + 1 })}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden />
                  </IconButton>
                  <IconButton
                    aria-label={t('menu.moveDown', { n: index + 1 })}
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </IconButton>
                  <IconButton
                    aria-label={t('menu.remove', { n: index + 1 })}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            append({ id: newRowId(), labelVi: '', hrefVi: '', labelEn: '', hrefEn: '' })
          }
        >
          {t('menu.add')}
        </Button>
      </div>
      <SubmitBar pending={pending} saved={saved} />
    </form>
  );
}
