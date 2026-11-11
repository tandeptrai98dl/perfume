import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';

/** Sign-in, sign-up and password pages (§5.1): storefront frame, narrow centred content. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main-content" className="flex-1">
          <div className="container-content flex justify-center py-12 lg:py-20">
            <div className="flex w-full max-w-md flex-col gap-8">{children}</div>
          </div>
        </main>
        <SiteFooter />
      </div>
    </NuqsAdapter>
  );
}
