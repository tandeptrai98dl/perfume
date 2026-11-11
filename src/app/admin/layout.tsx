import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import messages from '../../../messages/vi.json';

import '../fonts';
import '../globals.css';

/** Admin is Vietnamese-only in MVP, has no locale segment and is never indexed. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
  };
}

export default function AdminRootLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <html lang="vi">
      <body data-surface="admin">
        <NextIntlClientProvider
          locale="vi"
          messages={{ admin: messages.admin, ui: messages.ui }}
          timeZone="Asia/Ho_Chi_Minh"
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
