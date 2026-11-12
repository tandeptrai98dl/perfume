'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth/client';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/account', key: 'overview' },
  { href: '/account/orders', key: 'orders' },
  { href: '/account/addresses', key: 'addresses' },
  { href: '/account/profile', key: 'profile' },
  // M3 privacy stream: privacy centre.
  { href: '/account/privacy', key: 'privacy' },
] as const;

/**
 * AccountLayout sidebar (§8.2): horizontal scroller on mobile, vertical list from lg. Reads the
 * URL for the active item, so the layout renders it inside Suspense with `AccountNavFallback`.
 */
export function AccountNav() {
  return <AccountNavList pathname={usePathname()} />;
}

/** Same links without the active marker (prerendered shell). */
export function AccountNavFallback() {
  return <AccountNavList pathname={null} />;
}

function AccountNavList({ pathname }: { pathname: string | null }) {
  const t = useTranslations('account.nav');
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  function isActive(href: (typeof ITEMS)[number]['href']) {
    if (!pathname) return false;
    return href === '/account' ? pathname === href : pathname.startsWith(href);
  }

  return (
    <nav aria-label={t('label')} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
      <ul className="border-line-200 -mx-4 flex gap-1 overflow-x-auto border-b px-4 lg:mx-0 lg:flex-col lg:border-b-0 lg:px-0">
        {ITEMS.map((item) => (
          <li key={item.key} className="shrink-0">
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'eyebrow inline-flex min-h-11 items-center border-b-2 border-transparent px-3 lg:w-full lg:border-b-0 lg:border-l-2',
                'hover:text-gold-700',
                'aria-[current=page]:border-ink-950 aria-[current=page]:text-ink-950',
              )}
            >
              {t(item.key)}
            </Link>
          </li>
        ))}
        <li className="shrink-0 lg:mt-4">
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await authClient.signOut();
              router.replace('/');
              router.refresh();
            }}
            className="eyebrow hover:text-ink-950 inline-flex min-h-11 items-center gap-2 px-3 text-taupe-600 disabled:opacity-60 [&_svg]:size-4"
          >
            <LogOut aria-hidden />
            {t('signOut')}
          </button>
        </li>
      </ul>
    </nav>
  );
}
