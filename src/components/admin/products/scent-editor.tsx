'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Combobox } from '@/components/ui/combobox';
import { IconButton } from '@/components/ui/icon-button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import type { ProductEditorValues } from './editor-values';

type Option = { id: string; name: string };
const LAYERS = ['top', 'middle', 'base'] as const;

function AddCombobox({
  label,
  options,
  onAdd,
}: {
  label: string;
  options: Option[];
  onAdd: (id: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="flex max-w-xs flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      <Combobox
        id={id}
        options={options.map((option) => ({ value: option.id, label: option.name }))}
        value={value}
        onValueChange={(next) => {
          if (next) onAdd(next);
          setValue(null);
        }}
      />
    </div>
  );
}

/** NotePicker (3 layers) and scent families with exactly one primary (§8.4). */
export function ScentEditor({ notes, families }: { notes: Option[]; families: Option[] }) {
  const t = useTranslations('admin.products.scent');
  const form = useFormContext<ProductEditorValues>();
  const scent = useWatch({ control: form.control, name: 'scent' });
  const nameOf = (list: Option[], id: string) => list.find((o) => o.id === id)?.name ?? id;
  const familyError = form.formState.errors.scent?.families;

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section className="flex flex-col gap-6" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="text-h3">
          {t('notes')}
        </h2>
        {LAYERS.map((layer) => {
          const selected = scent.notes[layer];
          const layerName = t(`layers.${layer}`);
          return (
            <fieldset key={layer} className="flex flex-col gap-3">
              <legend className="text-small mb-2 font-medium">{layerName}</legend>
              {selected.length === 0 ? (
                <p className="text-small text-taupe-600">{t('none')}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {selected.map((noteId) => (
                    <li
                      key={noteId}
                      className="border-line-200 text-small flex items-center gap-1 border pl-3"
                    >
                      {nameOf(notes, noteId)}
                      <IconButton
                        aria-label={t('removeNote', { name: nameOf(notes, noteId) })}
                        className="size-9"
                        onClick={() =>
                          form.setValue(
                            `scent.notes.${layer}`,
                            selected.filter((id) => id !== noteId),
                            { shouldDirty: true },
                          )
                        }
                      >
                        <X aria-hidden />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <AddCombobox
                label={t('addNote', { layer: layerName.toLowerCase() })}
                options={notes.filter((note) => !selected.includes(note.id))}
                onAdd={(noteId) =>
                  form.setValue(`scent.notes.${layer}`, [...selected, noteId], {
                    shouldDirty: true,
                  })
                }
              />
            </fieldset>
          );
        })}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="families-heading">
        <h2 id="families-heading" className="text-h3">
          {t('families')}
        </h2>
        {scent.families.length === 0 ? (
          <p className="text-small text-taupe-600">{t('none')}</p>
        ) : (
          <RadioGroup
            aria-label={t('primary')}
            value={scent.families.find((f) => f.isPrimary)?.familyId ?? ''}
            onValueChange={(primaryId) =>
              form.setValue(
                'scent.families',
                scent.families.map((f) => ({ ...f, isPrimary: f.familyId === primaryId })),
                { shouldDirty: true },
              )
            }
            className="gap-2"
          >
            {scent.families.map((family) => {
              const radioId = `family-${family.familyId}`;
              return (
                <div
                  key={family.familyId}
                  className="border-line-200 flex items-center gap-3 border px-3"
                >
                  <RadioGroupItem id={radioId} value={family.familyId} />
                  <label
                    htmlFor={radioId}
                    className="text-small flex min-h-11 flex-1 items-center gap-2"
                  >
                    {nameOf(families, family.familyId)}
                    {family.isPrimary && <span className="text-taupe-600">({t('primary')})</span>}
                  </label>
                  <IconButton
                    aria-label={t('removeFamily', { name: nameOf(families, family.familyId) })}
                    onClick={() => {
                      const rest = scent.families.filter((f) => f.familyId !== family.familyId);
                      if (family.isPrimary && rest[0]) rest[0] = { ...rest[0], isPrimary: true };
                      form.setValue('scent.families', rest, { shouldDirty: true });
                    }}
                  >
                    <X aria-hidden />
                  </IconButton>
                </div>
              );
            })}
          </RadioGroup>
        )}
        {familyError?.message && (
          <p role="alert" className="text-small text-danger">
            {familyError.message}
          </p>
        )}
        <AddCombobox
          label={t('addFamily')}
          options={families.filter((f) => !scent.families.some((s) => s.familyId === f.id))}
          onAdd={(familyId) =>
            form.setValue(
              'scent.families',
              [...scent.families, { familyId, isPrimary: scent.families.length === 0 }],
              { shouldDirty: true },
            )
          }
        />
      </section>
    </div>
  );
}
