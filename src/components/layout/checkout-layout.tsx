import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, type ReactNode } from 'react';

import { SkipLink } from '@/components/ui/skip-link';
import { Link } from '@/i18n/navigation';

import { LanguageSwitcher, LanguageSwitcherFallback } from './language-switcher';

/**
 * Checkout frame (§8.2): logo and language only, no navigation, so nothing distracts from
 * placing the order. The language switch keeps the checkout (the cart is per browser, §10.7).
 */
export function CheckoutLayout({ children }: { children: ReactNode }) {
  const t = useTranslations();
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-line-200 bg-ivory-50 border-b">
        <div className="container-content flex items-center justify-between gap-4 py-3">
          <Link
            href="/"
            className="font-display text-h3 md:text-h2 tracking-wide whitespace-nowrap"
          >
            {t('metadata.siteName')}
          </Link>
          <div className="flex items-center gap-4">
            <p className="eyebrow hidden items-center gap-2 text-taupe-600 sm:inline-flex">
              <Lock aria-hidden className="size-3.5" />
              {t('checkout.secure')}
            </p>
            <Suspense fallback={<LanguageSwitcherFallback />}>
              <LanguageSwitcher />
            </Suspense>
          </div>
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
