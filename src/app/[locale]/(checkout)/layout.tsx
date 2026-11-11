import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Checkout group (§5.1): header and footer of the shop without the announcement bar.
 * NOTE (M2 merge): the checkout stream may ship its own `(checkout)/layout.tsx`; keep that one.
 * The result page only needs a layout that renders `<main id="main-content">`.
 */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </NuqsAdapter>
  );
}
