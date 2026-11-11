import { Suspense } from 'react';

import { AccountNav, AccountNavFallback } from '@/components/account/account-nav';

/**
 * AccountLayout (§8.2): sidebar + content. Static frame; each page checks the customer session
 * inside its own Suspense boundary and redirects to sign-in with `?next=`.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-content grid gap-8 py-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 lg:py-16">
      <Suspense fallback={<AccountNavFallback />}>
        <AccountNav />
      </Suspense>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
