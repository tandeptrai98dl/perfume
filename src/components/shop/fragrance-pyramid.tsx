import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { NoteLayer, ProductDetail } from '@/server/modules/catalog';

const NOTE_LAYERS: readonly NoteLayer[] = ['top', 'middle', 'base'];

/** Top / heart / base notes (§10.2). Each note links to the listing filtered by that note. */
export function FragrancePyramid({ notes }: { notes: ProductDetail['notes'] }) {
  const t = useTranslations();
  const layers = NOTE_LAYERS.filter((layer) => notes[layer].length > 0);
  if (layers.length === 0) {
    return <p className="text-taupe-600">{t('product.pyramid.empty')}</p>;
  }
  return (
    <ol className="flex flex-col gap-6" aria-label={t('product.pyramid.title')}>
      {layers.map((layer, index) => (
        <li key={layer} className="flex gap-4">
          <span aria-hidden className="font-display text-gold-700 w-6 shrink-0 text-xl leading-7">
            {['I', 'II', 'III'][index]}
          </span>
          <div className="flex flex-col gap-2">
            <h3 className="eyebrow text-taupe-600">{t(`catalog.noteLayer.${layer}`)}</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {notes[layer].map((note) => (
                <li key={note.id}>
                  <Link
                    href={{ pathname: '/perfumes', query: { note: note.slug } }}
                    className="hover:text-gold-700 inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                  >
                    {note.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
