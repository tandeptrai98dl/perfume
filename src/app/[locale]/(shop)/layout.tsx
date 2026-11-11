import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { AnnouncementBar } from '@/components/shop/announcement-bar';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <AnnouncementBar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </NuqsAdapter>
  );
}
