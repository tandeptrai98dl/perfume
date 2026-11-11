import { useTranslations } from 'next-intl';

/** First focusable element on every page; jumps to `<main id="main-content">`. */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  const t = useTranslations('navigation');
  return (
    <a
      href={`#${targetId}`}
      className="bg-ink-950 text-ivory-50 sr-only z-50 px-4 py-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t('skipToContent')}
    </a>
  );
}
